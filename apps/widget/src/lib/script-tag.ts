/**
 * Locate the <script> tag that loaded this widget on the host page and
 * extract its configuration attributes.
 *
 * The script is loaded with `defer`, so `document.currentScript` is no
 * longer available by the time we run. We find it by attribute instead.
 */

export type ScriptConfig = {
  widgetId: string;
  apiOrigin: string;
  /**
   * Operator-asserted visitor identity (Layer 2 — unsigned mode). The
   * host site declares "this visitor is user X" via
   *   <script ... data-opera-user-id="user_123" defer></script>
   * We trust the operator's frontend declaration in unsigned mode; quotas
   * bucket by `user:<id>` instead of `ip:<addr>` when present, so a single
   * visitor across IPs / devices gets a coherent rate-limit budget.
   *
   * If the operator wants the assertion to be unforgeable (a visitor
   * couldn't lie about their identity by editing the script tag), use the
   * signed-JWT mode — a separate option set in the dashboard.
   */
  visitorId?: string;
};

/** Tight allowlist for visitor IDs: alphanum and a few safe separators.
 *  Rejects whitespace, slashes, JSON-breaking chars, etc. — keeps the
 *  bucket-key column predictable and prevents an attacker from squatting
 *  on bucket keys via crafted IDs. */
const VISITOR_ID_PATTERN = /^[A-Za-z0-9._\-:@]{1,128}$/;

class ScriptConfigError extends Error {}

export function readScriptConfig(): ScriptConfig {
  const tag = document.querySelector<HTMLScriptElement>(
    "script[data-opera-id]"
  );
  if (!tag) {
    throw new ScriptConfigError(
      "Opera Concierge: no <script data-opera-id> tag found on the page."
    );
  }

  const widgetId = tag.dataset.operaId?.trim();
  if (!widgetId) {
    throw new ScriptConfigError(
      "Opera Concierge: data-opera-id attribute is empty."
    );
  }

  // 1. Explicit override (used in the dev playground).
  // 2. Derive from the script's own src — the dashboard serves both
  //    /widget.js and the API routes from the same origin.
  // 3. Fall back to the host page's origin (only useful when the script
  //    happens to be served from the same place as the dashboard).
  const override = tag.dataset.apiOrigin?.trim();
  const apiOrigin = override
    ? override.replace(/\/+$/, "")
    : tag.src
      ? new URL(tag.src, location.href).origin
      : location.origin;

  const rawVisitor = tag.dataset.operaUserId?.trim();
  let visitorId: string | undefined;
  if (rawVisitor) {
    if (VISITOR_ID_PATTERN.test(rawVisitor)) {
      visitorId = rawVisitor;
    } else {
      // Reject quietly with a console warning — we don't want to block
      // widget startup just because the operator typed a wrong ID format.
      // eslint-disable-next-line no-console
      console.warn(
        "Opera Concierge: data-opera-user-id format invalid (allowed: alphanumeric . _ - : @, max 128 chars). Falling back to IP-based quotas."
      );
    }
  }

  return { widgetId, apiOrigin, visitorId };
}

export { ScriptConfigError };
