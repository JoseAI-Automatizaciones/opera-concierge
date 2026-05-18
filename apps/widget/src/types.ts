/**
 * Public widget configuration returned by GET /api/widget/config.
 * Mirrors `PublicWidgetConfig` in the dashboard, kept independent so the
 * widget bundle has no dependency on dashboard internals.
 */
export type PublicCustomTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type PublicWidgetConfig = {
  id: string;
  name: string;
  primary_color: string;
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  voice: string;
  /** Wall-clock cap on a single session in seconds. The widget enforces this client-side. */
  max_session_seconds: number;
  /** Operator-defined custom tools — name/description/parameters only.
   *  The widget forwards these to OpenAI on session.update so the agent
   *  can call them. The actual HTTP request is proxied through
   *  /api/tools/call, never direct from the visitor's browser. */
  custom_tools: PublicCustomTool[];
};

/**
 * Response shape from POST /api/realtime/session.
 * Mirrors OpenAI's `/v1/realtime/client_secrets` endpoint response (flat).
 */
export type RealtimeSession = {
  value: string;
  expires_at: number;
  session?: {
    model?: string;
  };
  /** Server-issued capability for custom-tool proxy. Widget passes it on
   *  every /api/tools/call so the proxy can refuse direct-DevTools spam.
   *  Null when capability minting failed (custom tools won't work this
   *  round, but the realtime session itself still works). */
  opera_session_token?: string | null;
};

/** Status surfaced to the operator UI. */
export type WidgetStatus =
  | "idle"
  | "loading-config"
  | "config-error"
  | "ready"
  | "connecting"
  | "live"
  | "ended"
  | "error";

/** Minimal transcript entry; expand as we add tool calls. */
export type TranscriptEntry = {
  id: string;
  role: "user" | "assistant";
  text: string;
};
