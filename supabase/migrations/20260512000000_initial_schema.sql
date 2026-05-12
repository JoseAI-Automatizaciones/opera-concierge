-- ============================================================
-- Opera Concierge — Initial Schema
-- Creates the widgets table that drives configuration of every
-- embedded Opera Concierge widget.
-- ============================================================

-- ---------- widgets ----------
create table public.widgets (
  id uuid primary key default gen_random_uuid(),
  name text not null,

  -- Branding (sent to widget on /api/widget/config)
  primary_color text not null default '#B08A3E',
  position text not null default 'bottom-right'
    check (position in ('bottom-right', 'bottom-left', 'top-right', 'top-left')),

  -- LLM + voice behavior
  system_prompt text not null
    default 'You are Opera Concierge, a helpful AI agent embedded on this website. Help visitors search, navigate, and complete actions naturally.',
  voice text not null default 'verse',  -- OpenAI Realtime voice (verse | alloy | echo | shimmer | ...)
  llm_model text not null default 'gpt-realtime',

  -- Security: list of host origins allowed to embed this widget
  allowed_origins text[] not null default '{}',

  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.widgets is 'One row per embedded Opera Concierge widget. Configured via the dashboard.';

-- Auto-update updated_at on row change
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger widgets_set_updated_at
  before update on public.widgets
  for each row
  execute function public.set_updated_at();

-- ---------- RLS ----------
alter table public.widgets enable row level security;

-- Anonymous clients (the embedded widget on customer sites) can read public
-- configuration fields only. The API route at /api/widget/config validates
-- the requesting origin against allowed_origins before returning.
create policy "widgets_anon_select"
  on public.widgets
  for select
  to anon
  using (true);

-- The service role bypasses RLS (used by server-side dashboard mutations).
-- No explicit policy needed for service_role.
