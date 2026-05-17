"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { generateVisitorJwtSecret } from "@/lib/jwt";

const sharedFields = {
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
  // Optional in the form (defaults to "" if blank); the agent works without
  // it but is markedly less directive. We don't enforce a min length so
  // operators can erase the prompt back to the OpenAI default.
  system_prompt: z.string().max(8000).optional().default(""),
} as const;

const formSchema = z.object({
  ...sharedFields,
  openai_api_key: z
    .string()
    .trim()
    .min(20, "OpenAI key looks too short.")
    .max(500)
    .refine((v) => v.startsWith("sk-"), {
      message: "OpenAI keys typically start with 'sk-'.",
    }),
});

// On update the OpenAI key is optional: empty string means "leave existing
// key alone". A non-empty value replaces it.
const updateSchema = z.object({
  ...sharedFields,
  openai_api_key: z
    .string()
    .trim()
    .max(500)
    .optional()
    .default("")
    .refine((v) => v === "" || (v.length >= 20 && v.startsWith("sk-")), {
      message: "OpenAI keys typically start with 'sk-' and are at least 20 chars.",
    }),
});

export type CreateWidgetState = {
  ok: boolean;
  message: string;
};

export async function createWidget(
  _prev: CreateWidgetState | undefined,
  formData: FormData
): Promise<CreateWidgetState> {
  const user = await requireUser();

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
    system_prompt: formData.get("system_prompt") ?? "",
    openai_api_key: formData.get("openai_api_key") ?? "",
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
    system_prompt: parsed.data.system_prompt || null,
    openai_api_key: parsed.data.openai_api_key,
    owner_user_id: user.id,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath("/widgets");
  return { ok: true, message: "Widget created." };
}

export type UpdateWidgetState = {
  ok: boolean;
  message: string;
};

export async function updateWidget(
  id: string,
  _prev: UpdateWidgetState | undefined,
  formData: FormData
): Promise<UpdateWidgetState> {
  const user = await requireUser();

  const parsed = updateSchema.safeParse({
    name: formData.get("name"),
    allowed_origins: formData.get("allowed_origins") ?? "",
    primary_color: formData.get("primary_color") ?? "#B08A3E",
    position: formData.get("position") ?? "bottom-right",
    voice: formData.get("voice") ?? "verse",
    max_sessions_per_minute: formData.get("max_sessions_per_minute") ?? 5,
    max_sessions_per_day: formData.get("max_sessions_per_day") ?? 15,
    max_session_seconds: formData.get("max_session_seconds") ?? 480,
    max_response_output_tokens: formData.get("max_response_output_tokens") ?? 4096,
    system_prompt: formData.get("system_prompt") ?? "",
    openai_api_key: formData.get("openai_api_key") ?? "",
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
  // Build the patch — only include openai_api_key if the operator typed a
  // new one. Empty field means "keep the existing key", so we omit the
  // column entirely from the UPDATE.
  const patch: Record<string, unknown> = {
    name: parsed.data.name,
    primary_color: parsed.data.primary_color,
    position: parsed.data.position,
    voice: parsed.data.voice,
    allowed_origins: origins,
    max_sessions_per_minute: parsed.data.max_sessions_per_minute,
    max_sessions_per_day: parsed.data.max_sessions_per_day,
    max_session_seconds: parsed.data.max_session_seconds,
    max_response_output_tokens: parsed.data.max_response_output_tokens,
    system_prompt: parsed.data.system_prompt || null,
  };
  if (parsed.data.openai_api_key) {
    patch.openai_api_key = parsed.data.openai_api_key;
  }

  const { error } = await supabase
    .from("widgets")
    .update(patch)
    .eq("id", id)
    .eq("owner_user_id", user.id);

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath("/widgets");
  revalidatePath(`/widgets/${id}`);
  return { ok: true, message: "Widget updated." };
}

/** Generate or rotate the visitor JWT signing secret for a widget. Owner-
 *  scoped and idempotent — calling twice rotates the secret. Use null to
 *  disable signed mode (sets visitor_jwt_secret to NULL). */
export async function setVisitorJwtSecret(
  id: string,
  mode: "generate" | "rotate" | "disable"
): Promise<{ ok: boolean; secret?: string; message?: string }> {
  const user = await requireUser();
  const supabase = createAdminClient();

  const newSecret = mode === "disable" ? null : generateVisitorJwtSecret();

  const { error } = await supabase
    .from("widgets")
    .update({ visitor_jwt_secret: newSecret })
    .eq("id", id)
    .eq("owner_user_id", user.id);

  if (error) return { ok: false, message: error.message };

  revalidatePath(`/widgets/${id}`);
  revalidatePath("/widgets");
  return { ok: true, secret: newSecret ?? undefined };
}

export async function deleteWidget(id: string) {
  const user = await requireUser();
  const supabase = createAdminClient();
  // Scope delete to the operator's own widgets — even though admin client
  // bypasses RLS, the explicit owner filter prevents one operator from
  // deleting another's widget by guessing the id.
  const { error } = await supabase
    .from("widgets")
    .delete()
    .eq("id", id)
    .eq("owner_user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/widgets");
}
