-- ============================================================
-- Opera Concierge — Tighten max_response_output_tokens ceiling
--
-- The previous migration set the upper bound to 32000 generously, but
-- OpenAI Realtime's `session.max_output_tokens` is documented as
-- integer 1..4096 (or "inf", which we don't support yet). Values >4096
-- would cause the mint request to 4xx. Tighten the constraint so the
-- DB enforces what OpenAI expects.
-- ============================================================

alter table public.widgets
  drop constraint widgets_max_response_output_tokens_check;

alter table public.widgets
  add constraint widgets_max_response_output_tokens_check
  check (max_response_output_tokens between 100 and 4096);

-- Clamp any rows that somehow exceeded 4096 (safety net — none should
-- exist yet since the column defaults to 4096 and no manual overrides
-- have been allowed).
update public.widgets
   set max_response_output_tokens = 4096
 where max_response_output_tokens > 4096;
