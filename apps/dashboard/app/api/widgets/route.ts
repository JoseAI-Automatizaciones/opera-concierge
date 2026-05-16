import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getApiUser } from "@/lib/auth/session";
import { rowsToSafe, toSafeRow, type WidgetRow } from "@/lib/supabase/types";

/**
 * /api/widgets
 *
 * Dashboard-only management endpoints. Same-origin only (no CORS).
 * Requires an authenticated, allowlisted operator session. Uses the admin
 * Supabase client because RLS revokes anon SELECT on widgets.
 */

async function requireAuthUser() {
  const user = await getApiUser();
  if (!user) {
    return {
      user: null,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  return { user, response: null };
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  primary_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#B08A3E"),
  position: z
    .enum(["bottom-right", "bottom-left", "top-right", "top-left"])
    .default("bottom-right"),
  system_prompt: z.string().min(10).max(8000).optional(),
  voice: z.string().min(1).max(50).default("verse"),
  llm_model: z.string().min(1).max(120).default("gpt-realtime"),
  allowed_origins: z.array(z.url()).default([]),
});

export async function GET() {
  const { user, response } = await requireAuthUser();
  if (response) return response;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("widgets")
    .select("*")
    .eq("owner_user_id", user.id)
    .order("created_at", { ascending: false })
    .returns<WidgetRow[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // Strip openai_api_key before responding — same-origin authenticated
  // browser still shouldn't receive raw operator secrets in the JSON.
  return NextResponse.json({ widgets: rowsToSafe(data) });
}

export async function POST(req: Request) {
  const { user, response } = await requireAuthUser();
  if (response) return response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("widgets")
    .insert({ ...parsed.data, owner_user_id: user.id })
    .select("*")
    .single<WidgetRow>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // Strip openai_api_key from the response.
  return NextResponse.json({ widget: data ? toSafeRow(data) : null }, { status: 201 });
}
