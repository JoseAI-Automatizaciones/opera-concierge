import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth/session";
import { safeInternalPath } from "@/lib/auth/safe-redirect";

/**
 * GET /auth/confirm
 *
 * Magic-link callback. Accepts both Supabase Auth flows so that whichever
 * one the email template ends up triggering will land the user in the
 * dashboard:
 *
 *   - Modern OTP token_hash flow (our custom template):
 *       ?token_hash=...&type=email&next=...
 *     We call supabase.auth.verifyOtp().
 *
 *   - PKCE code-exchange flow (the @supabase/ssr default when calling
 *     signInWithOtp from a server with cookies):
 *       ?code=...
 *     We call supabase.auth.exchangeCodeForSession(). This is the same
 *     handling that lives on /, so the route works whether Supabase
 *     redirects here or to the site root.
 *
 * After either flow the user's email is re-checked against ALLOWED_EMAILS,
 * signed out if they don't match, and only then redirected to the
 * sanitized `next` path (default /widgets).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as
    | "email"
    | "magiclink"
    | "recovery"
    | "invite"
    | null;
  const next = safeInternalPath(url.searchParams.get("next"), "/widgets");

  const supabase = await createClient();

  // PKCE flow takes precedence — if both are present (shouldn't happen, but
  // safer this way), code is the canonical Supabase callback.
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
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

  if (!token_hash || !type) {
    return NextResponse.redirect(
      new URL("/login?e=missing_token", url).toString()
    );
  }

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
