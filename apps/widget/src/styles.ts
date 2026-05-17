/**
 * CSS injected into the widget's shadow root. We keep all widget styles in
 * here as a template string so the bundle is a single self-contained IIFE
 * and the host page's CSS cannot reach in.
 *
 * The `--opera-*` custom properties are applied to `:host` so the operator
 * can theme the widget via the public config (primary_color, etc.).
 */
export const widgetCss = `
  :host {
    --opera-gold: #b08a3e;
    --opera-amber: #d2b06b;
    --opera-graphite: #0e1117;
    --opera-black: #050505;
    --opera-white: #f5f7fa;
    --opera-muted: #8b93a7;
    all: initial;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--opera-white);
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  .root {
    position: fixed;
    z-index: 2147483600;
    pointer-events: none;
  }

  .root[data-position="bottom-right"] {
    right: 20px;
    bottom: 20px;
  }
  .root[data-position="bottom-left"] {
    left: 20px;
    bottom: 20px;
  }
  .root[data-position="top-right"] {
    right: 20px;
    top: 20px;
  }
  .root[data-position="top-left"] {
    left: 20px;
    top: 20px;
  }

  .button {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px 10px 12px;
    background: linear-gradient(135deg, var(--opera-gold), var(--opera-amber));
    color: var(--opera-black);
    border: none;
    border-radius: 999px;
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(255, 255, 255, 0.08);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.01em;
    cursor: pointer;
    transition:
      transform 150ms ease,
      box-shadow 150ms ease;
  }
  .button:hover {
    transform: translateY(-1px);
    box-shadow:
      0 12px 36px rgba(0, 0, 0, 0.45),
      0 0 0 1px rgba(255, 255, 255, 0.14);
  }
  .button:focus-visible {
    outline: 2px solid var(--opera-white);
    outline-offset: 3px;
  }

  .button .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--opera-black);
    opacity: 0.55;
  }
  .button[data-status="live"] .dot {
    background: #6ee0a3;
    opacity: 1;
    box-shadow: 0 0 0 4px rgba(110, 224, 163, 0.2);
  }

  .panel {
    pointer-events: auto;
    width: min(360px, calc(100vw - 40px));
    max-height: min(540px, calc(100vh - 120px));
    background: rgba(14, 17, 23, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 20px;
    box-shadow:
      0 24px 80px rgba(0, 0, 0, 0.55),
      0 0 0 1px rgba(255, 255, 255, 0.04);
    backdrop-filter: blur(14px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .root[data-position^="bottom"] .panel {
    margin-bottom: 12px;
  }
  .root[data-position^="top"] .panel {
    margin-top: 12px;
    order: -1;
  }

  .root[data-position$="left"] .stack {
    align-items: flex-start;
  }
  .root[data-position$="right"] .stack {
    align-items: flex-end;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .panel-title {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .panel-status {
    font-size: 11px;
    color: var(--opera-muted);
    text-transform: uppercase;
    letter-spacing: 0.16em;
  }
  .panel-close {
    background: transparent;
    border: 0;
    color: var(--opera-muted);
    cursor: pointer;
    font-size: 14px;
    padding: 4px 8px;
    border-radius: 6px;
  }
  .panel-close:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--opera-white);
  }

  .transcript {
    flex: 1;
    overflow-y: auto;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 14px;
    line-height: 1.5;
    color: var(--opera-white);
  }
  .transcript:empty::before {
    content: "Say hello or ask anything. The agent will respond by voice.";
    color: var(--opera-muted);
    font-size: 13px;
    line-height: 1.5;
  }

  .entry {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .entry .who {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--opera-muted);
  }
  .entry[data-role="user"] .who {
    color: var(--opera-amber);
  }

  .footer {
    padding: 10px 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: var(--opera-muted);
  }

  .end {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: var(--opera-white);
    padding: 6px 12px;
    border-radius: 999px;
    font-size: 12px;
    cursor: pointer;
  }
  .end:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .tool-activity {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed rgba(255, 255, 255, 0.08);
  }
  .tool-chip {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 10px;
    border-radius: 8px;
    background: rgba(210, 176, 107, 0.08);
    border: 1px solid rgba(210, 176, 107, 0.22);
    color: var(--opera-amber);
  }
  .tool-chip-head {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .tool-chip-detail {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 10px;
    color: rgba(245, 247, 250, 0.62);
    word-break: break-all;
  }
  .tool-chip[data-ok="false"] {
    color: #ffb3a8;
    background: rgba(255, 100, 90, 0.08);
    border-color: rgba(255, 100, 90, 0.28);
  }
  .tool-chip[data-ok="false"] .tool-chip-detail {
    color: rgba(255, 179, 168, 0.7);
  }
`;
