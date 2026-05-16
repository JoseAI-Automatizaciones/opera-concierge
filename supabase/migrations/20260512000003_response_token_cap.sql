-- ============================================================
-- Opera Concierge — Per-response token cap
--
-- Default ceiling on `max_response_output_tokens` passed to OpenAI Realtime
-- at mint time. Bounds the per-response token cost as a best-effort
-- (the client CAN override during session.update). Real policy boundary
-- remains the per-widget mint quota (Layer 1) + the operator's OpenAI
-- account spending cap.
-- ============================================================

alter table public.widgets
  add column max_response_output_tokens int not null default 4096
    check (max_response_output_tokens between 100 and 32000);

comment on column public.widgets.max_response_output_tokens is
  'Default cap on tokens-per-response sent to OpenAI Realtime at mint time. Client can override during the WebRTC session — defense-in-depth, not a hard boundary. Real boundary is the per-widget mint quota plus the operator''s OpenAI account spend cap.';
