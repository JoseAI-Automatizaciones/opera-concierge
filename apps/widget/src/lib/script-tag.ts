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
};

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

  return { widgetId, apiOrigin };
}

export { ScriptConfigError };
