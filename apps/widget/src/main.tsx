import { render } from "preact";
import { App } from "./App";
import { readScriptConfig, ScriptConfigError } from "./lib/script-tag";
import { widgetCss } from "./styles";

/**
 * Widget entry point. Runs when the embedded <script> tag is parsed.
 *
 * 1. Read widget config from the script tag's data attributes.
 * 2. Create a shadow-DOM host so the host page's CSS cannot leak in or out.
 * 3. Inject the widget CSS as a single <style> element inside the shadow.
 * 4. Mount the Preact app inside the shadow root, passing the host element
 *    so the app can set CSS variables on its own host without global lookups.
 *
 * Double-mount guard uses a globalThis symbol so we cannot be confused by
 * an unrelated element on the page that happens to share our tag name.
 */

const MOUNT_FLAG = "__operaConciergeMounted__";

type WindowWithFlag = Window & { [MOUNT_FLAG]?: boolean };

function boot() {
  const w = window as WindowWithFlag;
  if (w[MOUNT_FLAG]) return;

  let cfg: ReturnType<typeof readScriptConfig>;
  try {
    cfg = readScriptConfig();
  } catch (err) {
    if (err instanceof ScriptConfigError) {
      // Surface in console for the operator, but don't throw or render
      // anything onto the host page.
      // eslint-disable-next-line no-console
      console.warn(err.message);
      return;
    }
    throw err;
  }

  w[MOUNT_FLAG] = true;

  const host = document.createElement("opera-concierge-root");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = widgetCss;
  shadow.appendChild(style);

  const mount = document.createElement("div");
  shadow.appendChild(mount);

  render(
    <App
      widgetId={cfg.widgetId}
      apiOrigin={cfg.apiOrigin}
      shadowHost={host}
    />,
    mount
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
