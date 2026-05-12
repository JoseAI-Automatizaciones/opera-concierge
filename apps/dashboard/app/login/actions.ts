"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth/session";

const schema = z.object({
  email: z.email(),
});

export type LoginState = {
  ok: boolean;
  message: string;
};

export async function sendMagicLink(
  _prev: LoginState | undefined,
  formData: FormData
): Promise<LoginState> {
  const parsed = schema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { ok: false, message: "Enter a valid email." };
  }

  const email = parsed.data.email.trim().toLowerCase();

  // Fail closed: only allowlisted emails can request a link. Return the same
  // success message either way so we don't leak which emails are allowlisted.
  if (!isAllowedEmail(email)) {
    return {
      ok: true,
      message: "If that email is allowed, a link is on its way.",
    };
  }

  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/confirm`,
      shouldCreateUser: true,
    },
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  return {
    ok: true,
    message: "If that email is allowed, a link is on its way.",
  };
}
