-- ============================================================
-- Opera Concierge — Layer 2 (signed): per-widget JWT secret for
-- unforgeable visitor-identity attestation.
--
-- When this column is NULL: widget runs in unsigned mode. data-opera-user-id
-- from the host page is trusted as-is (Layer 2 unsigned).
--
-- When this column is set: widget runs in signed mode. The operator's
-- backend issues a JWT (HS256, signed with this secret) carrying a `sub`
-- claim with the visitor's ID and an `exp` claim. The widget reads it
-- from data-opera-user-token, forwards to the mint endpoint, and the
-- backend verifies. data-opera-user-id is IGNORED in this mode — once
-- signing is enabled, it's the only path.
--
-- Secret format: 64-hex-char string (32 bytes of entropy). Generated
-- server-side via crypto.randomUUID-derived helper or
-- gen_random_bytes(32)::text. Stored as-is; treated like an API key
-- (admin-client SELECT only, never crosses the WidgetRowSafe boundary).
-- ============================================================

alter table public.widgets
  add column visitor_jwt_secret text
    check (visitor_jwt_secret is null or length(visitor_jwt_secret) between 32 and 256);

comment on column public.widgets.visitor_jwt_secret is
  'HS256 secret for verifying visitor-identity JWTs (Layer 2 signed). NULL = signed mode disabled. NEVER expose to clients; treat like openai_api_key.';
