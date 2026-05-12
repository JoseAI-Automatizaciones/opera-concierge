import { NextResponse } from "next/server";

/**
 * CORS headers for widget-facing endpoints called from arbitrary host origins.
 * Origin is echoed unchanged when present — the route itself is responsible
 * for enforcing the allowlist before returning sensitive data.
 */
export function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

/**
 * Uniform 404 response used for every widget-facing failure path
 * (bad input, lookup miss, origin not allowed, etc.). Empty body so
 * nothing leaks; CORS headers attached so the browser can read the
 * status. Callers should ensure the DB has been queried regardless of
 * input validity to equalize timing.
 */
export function uniformNotFound(origin: string | null) {
  return new NextResponse(null, {
    status: 404,
    headers: corsHeaders(origin),
  });
}

/** Sentinel UUID used to keep DB-roundtrip timing identical for invalid input. */
export const SENTINEL_ID = "00000000-0000-0000-0000-000000000000";
