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
