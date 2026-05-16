"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";

const formSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  allowed_origins: z.string().transform((value) =>
    value
      .split(/\s+/)
      .map((line) => line.trim())
      .filter(Boolean)
  ),
  primary_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a hex color like #B08A3E"),
  position: z.enum(["bottom-right", "bottom-left", "top-right", "top-left"]),
  voice: z.string().min(1),
  max_sessions_per_minute: z.coerce.number().int().min(1).max(1000),
  max_sessions_per_day: z.coerce.number().int().min(1).max(100000),
  max_session_seconds: z.coerce.number().int().min(30).max(7200),
  max_response_output_tokens: z.coerce.number().int().min(100).max(4096),
});

export type CreateWidgetState = {
  ok: boolean;
  message: string;
};

export async function createWidget(
  _prev: CreateWidgetState | undefined,
  formData: FormData
): Promise<CreateWidgetState> {
  await requireUser();

  const parsed = formSchema.safeParse({
    name: formData.get("name"),
    allowed_origins: formData.get("allowed_origins") ?? "",
    primary_color: formData.get("primary_color") ?? "#B08A3E",
    position: formData.get("position") ?? "bottom-right",
    voice: formData.get("voice") ?? "verse",
    max_sessions_per_minute: formData.get("max_sessions_per_minute") ?? 5,
    max_sessions_per_day: formData.get("max_sessions_per_day") ?? 15,
    max_session_seconds: formData.get("max_session_seconds") ?? 480,
    max_response_output_tokens: formData.get("max_response_output_tokens") ?? 4096,
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const origins = parsed.data.allowed_origins;
  for (const origin of origins) {
    try {
      new URL(origin);
    } catch {
      return {
        ok: false,
        message: `Allowed origin is not a valid URL: ${origin}`,
      };
    }
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("widgets").insert({
    name: parsed.data.name,
    primary_color: parsed.data.primary_color,
    position: parsed.data.position,
    voice: parsed.data.voice,
    allowed_origins: origins,
    max_sessions_per_minute: parsed.data.max_sessions_per_minute,
    max_sessions_per_day: parsed.data.max_sessions_per_day,
    max_session_seconds: parsed.data.max_session_seconds,
    max_response_output_tokens: parsed.data.max_response_output_tokens,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath("/widgets");
  return { ok: true, message: "Widget created." };
}

export async function deleteWidget(id: string) {
  await requireUser();
  const supabase = createAdminClient();
  const { error } = await supabase.from("widgets").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/widgets");
}
