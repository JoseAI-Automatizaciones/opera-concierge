import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Edge middleware: refresh the Supabase auth session on every protected
 * request, and redirect unauthenticated visitors of operator-only paths
 * to /login.
 *
 * Public paths (NOT gated):
 *   /                      — marketing landing
 *   /login                 — auth entry
 *   /auth/*                — magic-link callback + signout
 *   /api/widget/config     — public, origin-allowlist gated
 *   /api/realtime/session  — public, origin-allowlist gated
 *   /widget.js, /icon.png, /logo.png, /favicon.png — static assets
 *
 * Protected paths (require a session — the per-page `requireUser()` then
 * re-checks the allowlist):
 *   /widgets/*
 *   /api/widgets/*
 *
 * Cookie-refresh pattern follows the canonical Supabase SSR shape:
 *   1. Build `response` from the request.
 *   2. Pass cookie getters/setters that mutate BOTH `request.cookies` (so
 *      subsequent server reads see the refreshed values) AND `response.cookies`
 *      (so the browser is told the new values).
 *   3. Recreate `response` exactly once after the request cookies are updated,
 *      then copy all the cookies onto it with their options.
 */

const PROTECTED_PATTERNS = [/^\/widgets(\/|$)/, /^\/api\/widgets(\/|$)/];

function isProtected(pathname: string): boolean {
  return PROTECTED_PATTERNS.some((re) => re.test(pathname));
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Mutate request cookies so anything downstream in this same
          // request sees the refreshed values.
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          // Rebuild the outgoing response ONCE with the updated request,
          // then attach all cookies with their full options.
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // IMPORTANT: getUser() must be awaited; calling it is what triggers the
  // cookie refresh callback. Per Supabase docs, do not do anything between
  // creating the client and calling getUser() — no extra route logic, no
  // logging, nothing that would consume the response object first.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isProtected(request.nextUrl.pathname) && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Run on everything EXCEPT Next internals and static asset extensions.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|map)$).*)",
  ],
};
