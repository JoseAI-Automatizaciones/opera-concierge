-- ============================================================
-- Opera Concierge — Operator-defined custom tools.
--
-- Operators can declare HTTP endpoints the agent may call (in addition to
-- the built-in DOM tools). Stored as a JSONB array on the widget row.
--
-- Schema (validated server-side at write time, not in the DB):
--   [
--     {
--       "name": "lookup_order",                 // ^[a-z][a-z0-9_]{0,39}$
--       "description": "Look up an order …",    // 1-500 chars, sent to model
--       "parameters": { ...JSON Schema... },    // sent to model
--       "endpoint": "https://api.shop.com/x",   // https only
--       "method": "POST",                       // v1: POST only
--       "auth_header": "Bearer sk-…",           // optional, ≤200 chars
--       "timeout_ms": 5000                      // optional, 100-30000
--     },
--     …
--   ]
--
-- The widget receives a public-safe projection (name/description/parameters
-- only) and forwards it to OpenAI on session.update. When the model calls
-- a custom tool, the widget POSTs to /api/tools/call which proxies to the
-- operator's endpoint with the auth_header attached server-side.
-- ============================================================

alter table public.widgets
  add column custom_tools jsonb not null default '[]'::jsonb
    check (jsonb_typeof(custom_tools) = 'array' and jsonb_array_length(custom_tools) <= 32);

comment on column public.widgets.custom_tools is
  'Array of operator-defined HTTP tools. Max 32 per widget. Validated server-side; endpoint + auth_header never cross to the client.';
