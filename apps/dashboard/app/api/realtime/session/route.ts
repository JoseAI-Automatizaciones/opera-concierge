import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import type { WidgetRow } from "@/lib/supabase/types";
import { corsHeaders, SENTINEL_ID, uniformNotFound } from "@/lib/api/cors";
import { bucketKeyFromRequest, consumeQuota } from "@/lib/quotas";

/**
 * POST /api/realtime/session
 * Body: { widget_id: string }
 *
 * Mints an ephemeral OpenAI Realtime client secret for the embedded widget
 * to open a WebRTC session directly with OpenAI. The server NEVER hands out
 * the long-lived OPENAI_API_KEY — only short-lived tokens scoped to a single
 * session configuration.
 *
 * Authorization: requesting origin must be allowlisted for the widget.
 * Quota: per-widget per-bucket (IP today) caps enforced atomically BEFORE
 * we mint the token, so an attacker cannot rack up OpenAI billing.
 * All failure paths return a timing-uniform 404 with no body, EXCEPT quota
 * exhaustion which returns a clear 429 with `Retry-After`.
 */

const bodySchema = z.object({ widget_id: z.uuid() });

const REALTIME_ENDPOINT = "https://api.openai.com/v1/realtime/client_secrets";

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

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("widgets")
    .select("*")
    .eq("id", lookupId)
    .maybeSingle<WidgetRow>();

  if (!parsed.success || error || !data) return uniformNotFound(origin);
  if (!origin || !data.allowed_origins.includes(origin)) {
    return uniformNotFound(origin);
  }

  // Quota check (Layer 1). Bucket by IP for v1; Layer 2 will accept an
  // operator-asserted user identifier and bucket per-user instead.
  const quota = await consumeQuota({
    widgetId: data.id,
    bucketKey: bucketKeyFromRequest(req),
    minuteLimit: data.max_sessions_per_minute,
    dayLimit: data.max_sessions_per_day,
  });

  if (!quota.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: {
          ...corsHeaders(origin),
          // 60s is conservative: minute window rolls every 60s, day window
          // every 24h. Most rejections will be the minute window.
          "Retry-After": "60",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "openai_key_not_configured" },
      { status: 503, headers: corsHeaders(origin) }
    );
  }

  // Token-policy boundary (best effort — see CLAUDE.md):
  //   - expires_after: short validity for the client_secret so a leaked
  //     token cannot be reused outside its intended session-startup window.
  //   - max_output_tokens: per-response token cap at mint time. The client
  //     can override via session.update once connected, so this bounds the
  //     well-behaved-client cost. Real billing protection is Layer 1 quotas
  //     plus the operator's OpenAI account spending cap.
  const upstream = await fetch(REALTIME_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 120 },
      session: {
        type: "realtime",
        model: data.llm_model,
        instructions: data.system_prompt,
        audio: { output: { voice: data.voice } },
        max_output_tokens: data.max_response_output_tokens,
      },
    }),
  });

  if (!upstream.ok) {
    return NextResponse.json(
      { error: "session_mint_failed" },
      { status: 502, headers: corsHeaders(origin) }
    );
  }

  const json = await upstream.json();
  return NextResponse.json(json, {
    headers: { ...corsHeaders(origin), "Cache-Control": "no-store" },
  });
}
