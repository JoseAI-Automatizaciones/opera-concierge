import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { toPublicConfig, type WidgetRow } from "@/lib/supabase/types";
import { corsHeaders, SENTINEL_ID, uniformNotFound } from "@/lib/api/cors";

/**
 * GET /api/widget/config?id=<widget_id>
 *
 * Called by the embedded widget on visitor pageload to fetch its public
 * configuration. The widgets table is NOT readable by the anon role — this
 * route is the only way to obtain widget config from the browser. Authorization
 * is by origin allowlist; every failure collapses to a single timing-uniform 404.
 */

const querySchema = z.object({ id: z.uuid() });

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ id: url.searchParams.get("id") });
  const lookupId = parsed.success ? parsed.data.id : SENTINEL_ID;

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

  return NextResponse.json(toPublicConfig(data), {
    headers: {
      ...corsHeaders(origin),
      "Cache-Control": "public, max-age=60, must-revalidate",
    },
  });
}
