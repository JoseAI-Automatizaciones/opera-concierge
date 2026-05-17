/**
 * Public widget configuration returned by GET /api/widget/config.
 * Mirrors `PublicWidgetConfig` in the dashboard, kept independent so the
 * widget bundle has no dependency on dashboard internals.
 */
export type PublicWidgetConfig = {
  id: string;
  name: string;
  primary_color: string;
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  voice: string;
  /** Wall-clock cap on a single session in seconds. The widget enforces this client-side. */
  max_session_seconds: number;
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
