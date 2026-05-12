import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import type { WidgetRow } from "@/lib/supabase/types";
import { corsHeaders, SENTINEL_ID, uniformNotFound } from "@/lib/api/cors";

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
 * All failure paths return a timing-uniform 404 with no body.
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

  // Parse body — be tolerant of malformed JSON so the failure path stays uniform.
  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }
  const parsed = bodySchema.safeParse(raw);
  const lookupId = parsed.success ? parsed.data.widget_id : SENTINEL_ID;

  // Always hit the DB regardless of input validity to equalize timing.
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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Server misconfiguration — surface as 503 to the operator's monitoring.
    // Not a uniform-404 because it's not a security failure.
    return NextResponse.json(
      { error: "openai_key_not_configured" },
      { status: 503, headers: corsHeaders(origin) }
    );
  }

  // Mint ephemeral key via OpenAI Realtime API. The session config (model,
  // voice, instructions) is pulled from the widget row — never trusted from
  // the client.
  const upstream = await fetch(REALTIME_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: data.llm_model,
        instructions: data.system_prompt,
        audio: { output: { voice: data.voice } },
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
