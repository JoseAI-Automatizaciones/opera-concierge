import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Authentication helpers for the operator dashboard.
 *
 * Single-user-friendly model for v1:
 * - Supabase Auth (magic-link email) handles the actual session.
 * - `ALLOWED_EMAILS` env var (comma-separated, lowercased) gates which
 *   addresses are allowed to log in. Empty/undefined = block everyone
 *   (fail closed) — required to be set before the dashboard is reachable
 *   from the public internet.
 */

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = process.env.ALLOWED_EMAILS;
  if (!raw) return false;
  const allow = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(email.trim().toLowerCase());
}

/** Returns the current authenticated AND allowlisted user, or null. */
export async function getUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  if (!isAllowedEmail(user.email)) return null;
  return user;
}

/**
 * Page-side gate: redirect to /login if there is no valid session.
 * Use inside Server Components or Server Actions for protected pages.
 */
export async function requireUser(redirectTo = "/login"): Promise<User> {
  const user = await getUser();
  if (!user) redirect(redirectTo);
  return user;
}

/**
 * API-side gate: returns the user or null. Callers should return a 401
 * response themselves so error shape stays consistent across endpoints.
 */
export async function getApiUser(): Promise<User | null> {
  return getUser();
}
