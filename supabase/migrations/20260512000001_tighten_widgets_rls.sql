-- ============================================================
-- Opera Concierge — Tighten widgets RLS
--
-- The initial migration granted anonymous SELECT on the full widgets
-- table. That exposes private columns (system_prompt, llm_model,
-- allowed_origins, timestamps) to anyone holding the anon key, which is
-- public by design. The /api/widget/config route was supposed to be
-- the security boundary via origin allowlist, but anon clients can
-- query Supabase directly and bypass it.
--
-- Fix: revoke anon SELECT on widgets entirely. All reads now go through
-- the dashboard's API routes, which use the service_role key server-side
-- and enforce origin allowlist + public-field projection before responding.
-- ============================================================

drop policy if exists "widgets_anon_select" on public.widgets;

-- Make the intent explicit: no anonymous access of any kind on widgets.
-- service_role bypasses RLS by default (used by API routes).
revoke all on public.widgets from anon;
