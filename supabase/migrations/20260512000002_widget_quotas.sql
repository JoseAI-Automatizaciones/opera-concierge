-- ============================================================
-- Opera Concierge — Widget quotas (Layer 1)
--
-- Per-widget rate limits on session minting, enforced atomically in
-- /api/realtime/session before we ever call OpenAI. Defaults are "medium":
--   5 sessions / minute  (burst)
--   15 sessions / day    (sustained, per visitor bucket)
--   480 seconds          (max session duration; widget enforces client-side)
-- All three are configurable per widget in the dashboard.
-- ============================================================

-- ---------- widgets columns ----------
alter table public.widgets
  add column max_sessions_per_minute int not null default 5
    check (max_sessions_per_minute between 1 and 1000),
  add column max_sessions_per_day int not null default 15
    check (max_sessions_per_day between 1 and 100000),
  add column max_session_seconds int not null default 480
    check (max_session_seconds between 30 and 7200);

comment on column public.widgets.max_sessions_per_minute is
  'Burst rate: max Realtime sessions per minute per visitor bucket.';
comment on column public.widgets.max_sessions_per_day is
  'Daily cap: max Realtime sessions per visitor bucket per UTC day.';
comment on column public.widgets.max_session_seconds is
  'Per-session wall clock cap. The widget auto-ends the session at this point.';

-- ---------- usage counters ----------
create table public.widget_usage (
  widget_id uuid not null references public.widgets(id) on delete cascade,
  bucket_key text not null,
  window_kind text not null check (window_kind in ('minute', 'day')),
  window_start timestamptz not null,
  count int not null default 0,
  primary key (widget_id, bucket_key, window_kind, window_start)
);

create index widget_usage_window_idx
  on public.widget_usage (window_start);

comment on table public.widget_usage is
  'Atomic counters used by consume_quota(). bucket_key is currently ip:<addr> but will accept user:<id> in Layer 2.';

-- Anon and authenticated roles never touch this table — only service_role
-- via the consume_quota function below.
alter table public.widget_usage enable row level security;
revoke all on public.widget_usage from anon, authenticated;

-- ---------- atomic check-and-consume ----------
-- Returns whether this attempt is within both the per-minute and per-day
-- caps, plus the post-increment counter values for debugging/observability.
-- INCREMENTS the counter regardless of whether the attempt is allowed —
-- this is intentional: once a bucket is over the limit in a window, every
-- further request stays blocked until the window rolls over.
create or replace function public.consume_quota(
  p_widget_id uuid,
  p_bucket_key text,
  p_minute_limit int,
  p_day_limit int
)
returns table(allowed boolean, minute_count int, day_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minute_window timestamptz := date_trunc('minute', now());
  v_day_window timestamptz := date_trunc('day', now());
  v_minute_count int;
  v_day_count int;
begin
  insert into public.widget_usage (widget_id, bucket_key, window_kind, window_start, count)
  values (p_widget_id, p_bucket_key, 'minute', v_minute_window, 1)
  on conflict (widget_id, bucket_key, window_kind, window_start)
  do update set count = public.widget_usage.count + 1
  returning public.widget_usage.count into v_minute_count;

  insert into public.widget_usage (widget_id, bucket_key, window_kind, window_start, count)
  values (p_widget_id, p_bucket_key, 'day', v_day_window, 1)
  on conflict (widget_id, bucket_key, window_kind, window_start)
  do update set count = public.widget_usage.count + 1
  returning public.widget_usage.count into v_day_count;

  return query select
    (v_minute_count <= p_minute_limit and v_day_count <= p_day_limit),
    v_minute_count,
    v_day_count;
end;
$$;

revoke all on function public.consume_quota(uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.consume_quota(uuid, text, int, int) to service_role;

-- Maintenance helper: deletes usage rows older than 7 days. Wire to a
-- pg_cron schedule later; for now, callable manually.
create or replace function public.purge_old_widget_usage()
returns int
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.widget_usage
    where window_start < now() - interval '7 days'
    returning 1
  )
  select count(*)::int from deleted;
$$;

revoke all on function public.purge_old_widget_usage() from public, anon, authenticated;
grant execute on function public.purge_old_widget_usage() to service_role;
