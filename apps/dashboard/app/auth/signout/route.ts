import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /auth/signout — same-origin signout endpoint.
 *
 * Defense-in-depth: rejects requests whose Origin header doesn't match Host.
 * Browsers send Origin on POSTs from `<form>` submissions; cross-site forms
 * targeting this endpoint will either omit Origin or send a foreign one,
 * either way failing this check. Supabase auth cookies are `SameSite=Lax`
 * by default, which is the primary line of defense — this is belt-and-braces.
 */
function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) {
    return new NextResponse(null, { status: 403 });
  }
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
