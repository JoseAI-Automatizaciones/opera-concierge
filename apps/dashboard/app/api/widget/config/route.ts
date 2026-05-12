import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { toPublicConfig, type WidgetRow } from "@/lib/supabase/types";

/**
 * GET /api/widget/config?id=<widget_id>
 *
 * Called by the embedded widget on visitor pageload to fetch its public
 * configuration. The widgets table is NOT readable by the anon role (see
 * migration 20260512000001_tighten_widgets_rls.sql) — this route is the
 * only way to obtain widget config from the browser.
 *
 * Authorization model: the requesting origin must be present in the widget's
 * `allowed_origins` column. Any failure (bad input, not found, origin not
 * allowed) collapses to a single 404 with no body, so an attacker cannot
 * distinguish "widget doesn't exist" from "widget exists but you can't see it".
 */

const querySchema = z.object({
  id: z.uuid(),
});

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function notFound(origin: string | null) {
  // Single response shape for all failure paths. We still echo CORS headers
  // so the browser can read the 404 status; the response body is empty so
  // there is nothing to leak.
  return new NextResponse(null, {
    status: 404,
    headers: corsHeaders(origin),
  });
}

export async function OPTIONS(req: Request) {
  // Preflight cannot validate against allowed_origins (we don't have the
  // widget_id yet). Echo the requesting origin so the browser proceeds to
  // GET, which is the actual authorization point.
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

// Sentinel UUID used when the requested id is malformed. It will never match
// a real row, so the DB lookup returns no data — keeping the failure-path
// timing identical to a valid-but-nonexistent id.
const SENTINEL_ID = "00000000-0000-0000-0000-000000000000";

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ id: url.searchParams.get("id") });
  const lookupId = parsed.success ? parsed.data.id : SENTINEL_ID;

  // Always hit the DB regardless of input validity, so an attacker cannot
  // distinguish "bad input" from "valid but not found / not allowed" by
  // measuring response time.
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("widgets")
    .select("*")
    .eq("id", lookupId)
    .maybeSingle<WidgetRow>();

  if (!parsed.success || error || !data) return notFound(origin);

  if (!origin || !data.allowed_origins.includes(origin)) {
    return notFound(origin);
  }

  return NextResponse.json(toPublicConfig(data), {
    headers: {
      ...corsHeaders(origin),
      "Cache-Control": "public, max-age=60, must-revalidate",
    },
  });
}
