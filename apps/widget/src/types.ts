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
 * Mirrors OpenAI's `client_secrets` endpoint response. We forward the
 * upstream JSON verbatim, so the value at `client_secret.value` is the
 * ephemeral key to use in the WebRTC handshake.
 */
export type RealtimeSession = {
  client_secret: {
    value: string;
    expires_at: number;
  };
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
