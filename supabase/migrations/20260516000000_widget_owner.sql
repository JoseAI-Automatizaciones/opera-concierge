-- ============================================================
-- Opera Concierge — Widget ownership (multi-operator readiness)
--
-- Adds owner_user_id to widgets so the dashboard can filter widgets per
-- operator. This is a prerequisite for Layer 2 (multi-tenant) and
-- removes the implicit "every allowlisted email sees every widget"
-- coupling of the single-user v1 model.
--
-- Nullable for back-compat: any pre-existing rows keep loading via the
-- service_role admin client paths, but the dashboard's filtered queries
-- treat them as orphaned (won't show). A follow-up migration may
-- enforce NOT NULL after the operator confirms no orphans remain.
--
-- RLS policies below are defense-in-depth: today all writes go through
-- the admin client which bypasses RLS, so the policies are quiet. If we
-- ever switch to user-scoped Supabase clients, operators can only see
-- and mutate their own widgets — never another operator's.
-- ============================================================

alter table public.widgets
  add column owner_user_id uuid references auth.users(id) on delete cascade;

comment on column public.widgets.owner_user_id is
  'auth.users.id of the operator who created this widget. Populated by /api/widgets POST and the createWidget Server Action. Nullable for back-compat; a future migration may enforce NOT NULL once all rows are owned.';

create index widgets_owner_user_id_idx
  on public.widgets (owner_user_id);

-- Authenticated operators can see / mutate ONLY widgets they own.
create policy "widgets_owner_select"
  on public.widgets
  for select
  to authenticated
  using (owner_user_id = auth.uid());

create policy "widgets_owner_insert"
  on public.widgets
  for insert
  to authenticated
  with check (owner_user_id = auth.uid());

create policy "widgets_owner_update"
  on public.widgets
  for update
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy "widgets_owner_delete"
  on public.widgets
  for delete
  to authenticated
  using (owner_user_id = auth.uid());
