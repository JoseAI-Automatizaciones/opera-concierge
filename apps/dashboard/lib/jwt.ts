/**
 * Minimal HS256 JWT verifier for Layer 2 signed visitor identity.
 *
 * Why not jose / jsonwebtoken: this is the only JWT path in the app, the
 * algorithm is fixed (HS256), and Web Crypto is available in the Vercel
 * Edge / Node 18+ runtimes we deploy to. Keeping the dependency surface
 * small reduces audit weight when we go public.
 *
 * Verification semantics:
 *   - Header alg MUST equal HS256. We do NOT honor any other algorithm
 *     even if the token declares one (the "alg=none" / algorithm-confusion
 *     family of attacks).
 *   - Signature is HMAC-SHA256 of the base64url-encoded header + "." +
 *     base64url-encoded payload, compared in constant-time-ish via the
 *     fixed-length byte equality that crypto.subtle.verify provides.
 *   - exp (NumericDate seconds since epoch) MUST be present and in the
 *     future, with a small clock-skew tolerance.
 *   - nbf (if present) MUST be in the past, same tolerance.
 *   - sub MUST be present and a non-empty string matching our visitor-id
 *     allowlist (alphanum + `._-:@`, max 128).
 *   - iat is read but not strictly enforced — operators may not set it.
 *
 * Returns a discriminated union so the caller can distinguish "invalid"
 * (treat as auth failure → fall back / reject) from "valid + sub".
 */

const VISITOR_ID_PATTERN = /^[A-Za-z0-9._\-:@]{1,128}$/;
const CLOCK_SKEW_SECONDS = 30;

export type JwtVerifyResult =
  | { ok: true; sub: string; exp: number }
  | { ok: false; reason: string };

export async function verifyVisitorJwt(
  token: string,
  secret: string
): Promise<JwtVerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) {
    return { ok: false, reason: "malformed" };
  }

  let header: { alg?: string; typ?: string };
  let payload: { sub?: unknown; exp?: unknown; nbf?: unknown; iat?: unknown };
  try {
    header = JSON.parse(b64uDecode(headerB64));
    payload = JSON.parse(b64uDecode(payloadB64));
  } catch {
    return { ok: false, reason: "malformed_json" };
  }

  // Fixed-algorithm guard against alg=none / algorithm confusion.
  if (header.alg !== "HS256") return { ok: false, reason: "bad_alg" };

  // Signature check.
  const enc = new TextEncoder();
  const keyMaterial = enc.encode(secret);
  const signingInput = enc.encode(`${headerB64}.${payloadB64}`);
  let signature: Uint8Array;
  try {
    signature = b64uDecodeBytes(sigB64);
  } catch {
    return { ok: false, reason: "bad_signature_encoding" };
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const sigValid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature as BufferSource,
    signingInput as BufferSource
  );
  if (!sigValid) return { ok: false, reason: "bad_signature" };

  // Claim checks.
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = payload.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    return { ok: false, reason: "missing_exp" };
  }
  if (exp + CLOCK_SKEW_SECONDS < nowSec) {
    return { ok: false, reason: "expired" };
  }
  // Sanity cap: reject tokens with absurdly far-future exp. 30 days max —
  // a token leak should not be a forever-bypass of quota.
  if (exp - nowSec > 60 * 60 * 24 * 30) {
    return { ok: false, reason: "exp_too_far" };
  }
  if (typeof payload.nbf === "number" && payload.nbf - CLOCK_SKEW_SECONDS > nowSec) {
    return { ok: false, reason: "not_yet_valid" };
  }
  const sub = payload.sub;
  if (typeof sub !== "string" || !VISITOR_ID_PATTERN.test(sub)) {
    return { ok: false, reason: "bad_sub" };
  }

  return { ok: true, sub, exp };
}

/** base64url → utf-8 string. */
function b64uDecode(input: string): string {
  return new TextDecoder().decode(b64uDecodeBytes(input));
}

/** base64url → raw bytes. */
function b64uDecodeBytes(input: string): Uint8Array {
  // Replace url-safe chars, pad to multiple of 4.
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Generate a fresh HS256 secret (32 random bytes, hex-encoded → 64 chars). */
export function generateVisitorJwtSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Server-side session-binding tokens for the custom-tool proxy. Signed
 * with SUPABASE_SERVICE_ROLE_KEY (already a long, high-entropy server-only
 * secret — no new env var to manage).
 *
 * What this PROTECTS:
 *   - Calls to /api/tools/call must correspond to an active realtime
 *     session that was minted through /api/realtime/session (and thus
 *     passed the mint quota check). An attacker can't open /api/tools/call
 *     without first burning a session quota slot.
 *   - The TTL caps the window over which a leaked token is replayable.
 *   - Per-session tool-call quotas + verified visitor bucketing throttle
 *     abuse from any single session.
 *
 * What this DOES NOT PROTECT (be honest with operators):
 *   - A visitor with DevTools / XSS on an allowed origin can still read
 *     the token from their own session's response and replay it within
 *     the TTL. They can craft arbitrary tool_name + args. The proxy will
 *     attach the operator's auth_header server-side and forward.
 *   - Therefore: operators MUST treat tool-call args as UNTRUSTED INPUT
 *     and validate them in their backend (auth, scoping, sanity checks).
 *     The capability provides session binding + audit + rate-limit
 *     anchoring, not arg authentication.
 */

function getCapabilitySecret(): string {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY — capability tokens cannot be signed."
    );
  }
  return s;
}

function b64uEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64uEncodeString(s: string): string {
  return b64uEncode(new TextEncoder().encode(s));
}

export async function mintSessionCapability(
  widgetId: string,
  ttlSeconds = 10 * 60,
  visitorSub?: string | null
): Promise<string> {
  const header = b64uEncodeString(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    sub: widgetId,
    iat: now,
    exp: now + ttlSeconds,
    scope: "tools.call",
  };
  // Bind the verified visitor sub INTO the capability when known. The
  // proxy can then trust the visitor identity without re-verifying the
  // original (possibly shorter-lived) visitor JWT on every tool call.
  if (visitorSub) claims.visitor_sub = visitorSub;
  const payload = b64uEncodeString(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getCapabilitySecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput))
  );
  return `${signingInput}.${b64uEncode(sigBytes)}`;
}

export type CapabilityVerification =
  | { ok: true; widgetId: string; visitorSub: string | null }
  | { ok: false; reason: string };

export async function verifySessionCapability(
  token: string,
  expectedWidgetId: string
): Promise<CapabilityVerification> {
  // The capability is itself a JWT signed with the service-role key.
  // Re-decode here to read the visitor_sub claim that mintSessionCapability
  // may have bound in — verifyVisitorJwt only returns sub (the widget id).
  const result = await verifyVisitorJwt(token, getCapabilitySecret());
  if (!result.ok) return { ok: false, reason: result.reason };
  if (result.sub !== expectedWidgetId) {
    return { ok: false, reason: "widget_mismatch" };
  }
  // Decode the payload to enforce scope and extract visitor_sub.
  let visitorSub: string | null = null;
  try {
    const parts = token.split(".");
    const payloadJson = atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/").padEnd(parts[1]!.length + ((4 - (parts[1]!.length % 4)) % 4), "="));
    const payload = JSON.parse(payloadJson) as { scope?: unknown; visitor_sub?: unknown };
    // Enforce scope so a JWT minted by a different server path (also
    // signed with the service-role key) can't unlock this route.
    if (payload.scope !== "tools.call") {
      return { ok: false, reason: "bad_scope" };
    }
    if (typeof payload.visitor_sub === "string") visitorSub = payload.visitor_sub;
  } catch {
    return { ok: false, reason: "decode_failed" };
  }
  return { ok: true, widgetId: result.sub, visitorSub };
}
