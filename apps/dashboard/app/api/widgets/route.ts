import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import type { WidgetRow } from "@/lib/supabase/types";

/**
 * /api/widgets
 *
 * Dashboard-only management endpoints. Same-origin only (no CORS), single-user
 * v1 (no auth gate yet — to be added before public deploy). Uses the admin
 * client because RLS revokes anon SELECT on widgets.
 */

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
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("widgets")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<WidgetRow[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ widgets: data ?? [] });
}

export async function POST(req: Request) {
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
    .insert(parsed.data)
    .select("*")
    .single<WidgetRow>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ widget: data }, { status: 201 });
}
