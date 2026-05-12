/**
 * Validate a `next`-style redirect parameter so we never trust caller-supplied
 * URLs. Only same-origin INTERNAL paths are allowed; anything else falls back
 * to the default.
 *
 * Rejected vectors (each line ends `→ fallback`):
 *   null / undefined / non-string                → fallback
 *   ""                                            → fallback
 *   "https://evil.tld/..."                        → fallback (no leading "/")
 *   "//evil.tld/..."                              → fallback (protocol-relative)
 *   "/\\evil.tld" (or any "\" in the path)        → fallback (browsers normalize \ to /)
 *   "/javascript:alert(1)"                        → fallback (scheme-like prefix)
 *   "/data:text/html,..."                         → fallback (scheme-like prefix)
 *
 * Accepted:
 *   "/widgets"
 *   "/widgets/abc-123"
 *   "/widgets?foo=bar"
 *
 * The scheme check uses `^/+\w+:` so any number of leading slashes followed
 * by a word-character scheme + colon is rejected.
 */
export function safeInternalPath(
  value: string | null | undefined,
  fallback: string
): string {
  if (!value || typeof value !== "string") return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.includes("\\")) return fallback;
  if (/^\/+\w+:/.test(value)) return fallback;
  return value;
}
