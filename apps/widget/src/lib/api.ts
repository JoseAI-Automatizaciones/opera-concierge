import type { PublicWidgetConfig, RealtimeSession } from "../types";

/**
 * Tiny fetch wrapper around the dashboard's widget-facing endpoints.
 * All endpoints collapse failures to a 404 with no body, so the widget
 * only needs to know "did I get JSON back".
 */
export async function fetchWidgetConfig(
  apiOrigin: string,
  widgetId: string
): Promise<PublicWidgetConfig> {
  const url = `${apiOrigin}/api/widget/config?id=${encodeURIComponent(widgetId)}`;
  const res = await fetch(url, { method: "GET", credentials: "omit" });
  if (!res.ok) {
    throw new Error(
      `Opera Concierge: failed to load widget config (${res.status}).`
    );
  }
  return (await res.json()) as PublicWidgetConfig;
}

export class RateLimitedError extends Error {
  constructor() {
    super(
      "You've used Opera Concierge a lot recently. Please wait a moment and try again."
    );
    this.name = "RateLimitedError";
  }
}

export async function mintRealtimeSession(
  apiOrigin: string,
  widgetId: string,
  visitorId?: string
): Promise<RealtimeSession> {
  const url = `${apiOrigin}/api/realtime/session`;
  const body: Record<string, string> = { widget_id: widgetId };
  if (visitorId) body.visitor_id = visitorId;
  const res = await fetch(url, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429) {
    throw new RateLimitedError();
  }
  if (!res.ok) {
    throw new Error(
      `Opera Concierge: failed to mint realtime session (${res.status}).`
    );
  }
  return (await res.json()) as RealtimeSession;
}
