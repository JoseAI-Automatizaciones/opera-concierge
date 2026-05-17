-- ============================================================
-- Opera Concierge — Layer 2: dual-bucket atomic quota check
--
-- consume_quota() increments unconditionally. With Layer 2 we charge
-- TWO buckets (user:<id> + ip:<addr>) and both must pass. Doing that
-- as two consume_quota calls in sequence has two correctness bugs:
--   1. If the second bucket fails, the first has already incremented
--      → legit visitor burns their quota for sessions that never minted.
--   2. Retries from an exhausted-first-bucket request keep burning the
--      second bucket → shared NAT cascade failures.
--
-- consume_dual_quota uses the atomic "upsert-then-check-then-rollback"
-- pattern: each upsert takes a row lock that serializes concurrent
-- callers on the same bucket (so the returned `count` is the true
-- post-increment value, not a pre-peek stale snapshot). If any count
-- exceeds the limit, we RAISE EXCEPTION inside the function so plpgsql
-- rolls back all upserts via the implicit subtransaction. Net effect:
-- under contention the function still serializes correctly, and on
-- denial NO bucket is incremented.
--
-- Single bucket use: pass NULL for secondary. Behavior collapses to
-- the same correctness as the original consume_quota.
-- ============================================================

create or replace function public.consume_dual_quota(
  p_widget_id uuid,
  p_primary_bucket text,
  p_secondary_bucket text,
  p_minute_limit int,
  p_day_limit int
)
returns table(allowed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minute_window timestamptz := date_trunc('minute', now());
  v_day_window timestamptz := date_trunc('day', now());
  v_p_min int;
  v_p_day int;
  v_s_min int;
  v_s_day int;
  -- Lock order: always upsert in lexically-sorted bucket order so two
  -- concurrent calls with the buckets in swapped primary/secondary roles
  -- acquire row locks in the same order — no deadlock.
  v_first text;
  v_second text;
begin
  if p_secondary_bucket is null or p_secondary_bucket = p_primary_bucket then
    v_first := p_primary_bucket;
    v_second := null;
  elsif p_primary_bucket < p_secondary_bucket then
    v_first := p_primary_bucket;
    v_second := p_secondary_bucket;
  else
    v_first := p_secondary_bucket;
    v_second := p_primary_bucket;
  end if;

  -- Block-with-EXCEPTION gives us an implicit savepoint: if we RAISE
  -- inside, every INSERT above is rolled back.
  begin
    -- First bucket — minute window.
    insert into public.widget_usage (widget_id, bucket_key, window_kind, window_start, count)
      values (p_widget_id, v_first, 'minute', v_minute_window, 1)
      on conflict (widget_id, bucket_key, window_kind, window_start)
      do update set count = public.widget_usage.count + 1
      returning count into v_p_min;

    -- First bucket — day window.
    insert into public.widget_usage (widget_id, bucket_key, window_kind, window_start, count)
      values (p_widget_id, v_first, 'day', v_day_window, 1)
      on conflict (widget_id, bucket_key, window_kind, window_start)
      do update set count = public.widget_usage.count + 1
      returning count into v_p_day;

    if v_p_min > p_minute_limit or v_p_day > p_day_limit then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;

    if v_second is not null then
      insert into public.widget_usage (widget_id, bucket_key, window_kind, window_start, count)
        values (p_widget_id, v_second, 'minute', v_minute_window, 1)
        on conflict (widget_id, bucket_key, window_kind, window_start)
        do update set count = public.widget_usage.count + 1
        returning count into v_s_min;

      insert into public.widget_usage (widget_id, bucket_key, window_kind, window_start, count)
        values (p_widget_id, v_second, 'day', v_day_window, 1)
        on conflict (widget_id, bucket_key, window_kind, window_start)
        do update set count = public.widget_usage.count + 1
        returning count into v_s_day;

      if v_s_min > p_minute_limit or v_s_day > p_day_limit then
        raise exception 'rate_limited' using errcode = 'P0001';
      end if;
    end if;

    return query select true;
    return;
  exception when sqlstate 'P0001' then
    -- Any RAISE above rolled back every INSERT in this BEGIN block.
    return query select false;
    return;
  end;
end;
$$;

revoke all on function public.consume_dual_quota(uuid, text, text, int, int) from public, anon, authenticated;
grant execute on function public.consume_dual_quota(uuid, text, text, int, int) to service_role;
