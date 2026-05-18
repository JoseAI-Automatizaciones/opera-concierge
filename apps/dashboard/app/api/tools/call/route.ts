import { NextResponse } from "next/server";
import { z } from "zod";
import { promises as dns } from "node:dns";
import { createAdminClient } from "@/lib/supabase/server";
import type { CustomToolDef, WidgetRow } from "@/lib/supabase/types";
import { corsHeaders, SENTINEL_ID, uniformNotFound } from "@/lib/api/cors";
import { verifySessionCapability } from "@/lib/jwt";
import { isPrivateIp } from "@/lib/net";
import { bucketKeyFromRequest, consumeQuota } from "@/lib/quotas";

// This route uses Node.js DNS resolution (no Edge runtime support).
export const runtime = "nodejs";

/**
 * POST /api/tools/call
 * Body: { widget_id, tool_name, args, visitor_id?, visitor_token? }
 *
 * Proxy from the embedded widget to one of the operator's custom HTTP
 * tools. Strict origin allowlist, the operator's auth_header is attached
 * server-side (never crosses to the client), responses are size-capped.
 *
 * Failure paths return uniform 404 to avoid leaking which tool exists
 * or whether the widget id is valid. The model receives a generic
 * { ok: false, error } and can recover.
 */

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const VISITOR_ID_PATTERN = /^[A-Za-z0-9._\-:@]{1,128}$/;

const bodySchema = z.object({
  widget_id: z.uuid(),
  tool_name: z.string().regex(TOOL_NAME_PATTERN),
  args: z.unknown(),
  // visitor_id is only honored when the widget is in unsigned mode AND
  // the capability didn't bind a verified visitor_sub. In signed mode the
  // capability's visitor_sub wins.
  visitor_id: z.string().regex(VISITOR_ID_PATTERN).optional(),
  /** Server-issued capability from /api/realtime/session. Required — the
   *  proxy refuses calls without it so a visitor can't bypass the agent
   *  and hit the operator's backend directly from DevTools. */
  opera_session_token: z
    .string()
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    .max(2048),
});

const MAX_RESPONSE_BYTES = 8 * 1024; // 8 KB — keeps model context bounded
const DEFAULT_TIMEOUT_MS = 5000;

const PRIVATE_HOST_PATTERN =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc00:|fd00:)/i;

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");

  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }
  const parsed = bodySchema.safeParse(raw);
  const lookupId = parsed.success ? parsed.data.widget_id : SENTINEL_ID;

  // Always roundtrip the DB to keep timing uniform across valid / invalid input.
  const supabase = createAdminClient();
  const { data: widget, error: dbError } = await supabase
    .from("widgets")
    .select("*")
    .eq("id", lookupId)
    .maybeSingle<WidgetRow>();

  if (!parsed.success || dbError || !widget) return uniformNotFound(origin);
  if (!origin || !widget.allowed_origins.includes(origin)) {
    return uniformNotFound(origin);
  }

  // CRITICAL: verify the capability before doing anything else. Origin
  // allowlist alone is not enough — a script running on an allowed origin
  // (DevTools or XSS-injected) would otherwise be able to invoke any
  // operator tool directly. The capability is HS256-signed by the mint
  // endpoint and bound to this widget_id with ~10 min TTL.
  const capability = await verifySessionCapability(
    parsed.data.opera_session_token,
    parsed.data.widget_id
  );
  if (!capability.ok) return uniformNotFound(origin);

  // Visitor identity comes from the capability when bound (signed mode at
  // mint time), or falls back to the body's unsigned visitor_id. We do NOT
  // re-verify the operator's visitor JWT on every call: the capability
  // already carries the verified sub from mint time, so tools keep working
  // for the full capability TTL even if the operator's visitor JWT has
  // expired. The capability's own exp is the source of truth.
  const verifiedVisitorId = capability.visitorSub;
  const unverifiedVisitorId =
    !verifiedVisitorId && parsed.data.visitor_id ? parsed.data.visitor_id : null;

  // Validate the requested tool name BEFORE charging the proxy quota —
  // otherwise a session-bound attacker could spam unknown names from
  // DevTools and burn down the operator's tool-call budget without ever
  // reaching a real endpoint.
  //
  // Identity headers forwarded to the operator's backend are also resolved
  // here; verified (JWT-bound capability) vs unverified (raw script-tag
  // value) so backends doing account/order lookup don't trust the wrong
  // one. Signed mode → X-Opera-Visitor; unsigned → X-Opera-Visitor-Unverified.
  const tools = (widget.custom_tools ?? []) as CustomToolDef[];
  const tool = tools.find((t) => t.name === parsed.data.tool_name);
  if (!tool) return uniformNotFound(origin);

  // Rate limit the proxy itself. Same atomic dual-bucket as the mint
  // route, scaled up since one chat session normally triggers many tool
  // calls. v1: 10× the per-minute / per-day session caps gives a
  // generous-but-bounded ceiling per visitor / IP before further calls
  // are 429'd. User bucket keyed by VERIFIED sub when present (or the
  // unverified raw id otherwise — same trust level as the mint route).
  const TOOLCALL_MULTIPLIER = 10;
  const userBucketId = verifiedVisitorId ?? unverifiedVisitorId;
  const toolQuota = await consumeQuota({
    widgetId: widget.id,
    primaryBucket: `tools-ip:${bucketKeyFromRequest(req)}`,
    secondaryBucket: userBucketId ? `tools-user:${userBucketId}` : null,
    minuteLimit: widget.max_sessions_per_minute * TOOLCALL_MULTIPLIER,
    dayLimit: widget.max_sessions_per_day * TOOLCALL_MULTIPLIER,
  });
  if (!toolQuota.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { ...corsHeaders(origin), "Retry-After": "60" } }
    );
  }

  // Re-check the endpoint at request time. The config-write validator
  // already enforces https-only + private-hostname regex, but a public
  // hostname can resolve to a private IP via DNS rebinding. Resolve here
  // and refuse if ANY resolved A/AAAA record is in a private range.
  // (A residual TOCTOU window remains between this resolution and fetch's
  // own resolution — accept for v1; full mitigation requires fetching by
  // resolved IP with explicit Host header, which Node fetch doesn't make
  // ergonomic.)
  let endpoint: URL;
  try {
    endpoint = new URL(tool.endpoint);
  } catch {
    return jsonError(origin, "tool_misconfigured");
  }
  if (endpoint.protocol !== "https:") return jsonError(origin, "tool_misconfigured");
  if (PRIVATE_HOST_PATTERN.test(endpoint.hostname)) {
    return jsonError(origin, "tool_misconfigured");
  }
  // If the hostname is already an IP literal, the regex above covered the
  // common private cases but not multicast / CGNAT / IPv4-mapped IPv6.
  // Resolve via DNS (which is a no-op fast path for IP literals on most
  // resolvers) and check every record with isPrivateIp.
  try {
    const records = await dns.lookup(endpoint.hostname, { all: true, verbatim: true });
    for (const r of records) {
      if (isPrivateIp(r.address)) {
        return jsonError(origin, "tool_misconfigured");
      }
    }
  } catch {
    return jsonError(origin, "tool_unreachable");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "OperaConcierge/1.0",
  };
  if (tool.auth_header) headers["Authorization"] = tool.auth_header;
  if (verifiedVisitorId) headers["X-Opera-Visitor"] = verifiedVisitorId;
  if (unverifiedVisitorId) headers["X-Opera-Visitor-Unverified"] = unverifiedVisitorId;
  headers["X-Opera-Widget-Id"] = widget.id;

  const timeoutMs = Math.min(Math.max(tool.timeout_ms ?? DEFAULT_TIMEOUT_MS, 100), 30000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // The AbortController must remain armed for the ENTIRE upstream
  // interaction — fetch resolves once headers are in, but reading the
  // body can still stall on a slow / trickling endpoint. We only clear
  // the timer after the body read finishes (or aborts).
  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(parsed.data.args ?? {}),
      signal: controller.signal,
      redirect: "manual",
    });
  } catch {
    clearTimeout(timer);
    return jsonError(origin, "tool_unreachable");
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    clearTimeout(timer);
    return jsonError(origin, "tool_redirected");
  }

  // Bounded read with the original abort signal still active.
  const reader = upstream.body?.getReader();
  let bytes = new Uint8Array(0);
  let aborted = false;
  if (reader) {
    try {
      while (bytes.byteLength < MAX_RESPONSE_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const combined = new Uint8Array(bytes.byteLength + value.byteLength);
        combined.set(bytes, 0);
        combined.set(value, bytes.byteLength);
        bytes = combined.slice(0, MAX_RESPONSE_BYTES);
        if (bytes.byteLength >= MAX_RESPONSE_BYTES) break;
      }
    } catch {
      aborted = true;
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
  }
  clearTimeout(timer);
  // Fail closed on ANY body-read interruption (timeout, connection reset,
  // socket error, etc.). Returning the partial bytes would let a flaky
  // upstream feed the model truncated JSON that parses successfully but
  // is semantically wrong.
  if (aborted) {
    return jsonError(
      origin,
      controller.signal.aborted ? "tool_timeout" : "tool_read_error"
    );
  }

  const text = new TextDecoder().decode(bytes);
  // Try to parse as JSON; if the operator's endpoint returned non-JSON,
  // wrap the raw text.
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 1000) };
  }

  return NextResponse.json(
    {
      ok: upstream.ok,
      status: upstream.status,
      body,
    },
    { headers: { ...corsHeaders(origin), "Cache-Control": "no-store" } }
  );
}

function jsonError(origin: string | null, code: string) {
  return NextResponse.json(
    { ok: false, error: code },
    { status: 502, headers: corsHeaders(origin) }
  );
}
