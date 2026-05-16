-- ============================================================
-- Opera Concierge — Per-widget OpenAI API key
--
-- Each widget carries its own OpenAI API key. The dashboard form captures
-- it at widget creation; /api/realtime/session reads it from the widget
-- row instead of a single global OPENAI_API_KEY env var. Lets the operator
-- (or future multi-tenant operators) use different OpenAI accounts per
-- widget without touching deployment env vars.
--
-- Security:
--   - Column is nullable so existing rows are not blocked.
--   - RLS already revokes anon SELECT on widgets (only service_role reads).
--   - Supabase encrypts the DB at rest.
--   - The key is NEVER projected to PublicWidgetConfig — it stays server-side.
-- ============================================================

alter table public.widgets
  add column openai_api_key text;

comment on column public.widgets.openai_api_key is
  'OpenAI API key used to mint Realtime sessions for this widget. NEVER returned to anon clients. Plaintext for v1 single-user; future multi-tenant deployments should encrypt with pgcrypto + a Vercel-held secret.';
