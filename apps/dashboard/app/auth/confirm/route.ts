import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth/session";
import { safeInternalPath } from "@/lib/auth/safe-redirect";

/**
 * GET /auth/confirm?token_hash=...&type=...&next=...
 *
 * Magic-link callback. Verifies the OTP with Supabase, then double-checks
 * the resulting user's email against ALLOWED_EMAILS before redirecting to
 * the protected area. The `next` query parameter is sanitized to a same-origin
 * internal path so we cannot be used as an open redirect.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as
    | "email"
    | "magiclink"
    | "recovery"
    | "invite"
    | null;
  const next = safeInternalPath(url.searchParams.get("next"), "/widgets");

  if (!token_hash || !type) {
    return NextResponse.redirect(
      new URL("/login?e=missing_token", url).toString()
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash, type });

  if (error || !data.user) {
    return NextResponse.redirect(
      new URL("/login?e=invalid_or_expired_link", url).toString()
    );
  }

  if (!isAllowedEmail(data.user.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      new URL("/login?e=not_allowed", url).toString()
    );
  }

  return NextResponse.redirect(new URL(next, url).toString());
}
