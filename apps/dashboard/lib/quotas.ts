import { createAdminClient } from "@/lib/supabase/server";

/**
 * Bucket key for IP-based quota counting. Extracts in priority order:
 *   1. x-forwarded-for first hop
 *   2. x-real-ip
 *   3. cf-connecting-ip (Cloudflare)
 *   4. fallback "unknown"
 *
 * "unknown" still gets bucketed — many requests with no resolvable IP would
 * pile into one bucket and block each other, which is the safer failure mode
 * than letting them all through.
 *
 * Visitor-identity bucketing (`user:<id>`) is handled in the route layer
 * (apps/dashboard/app/api/realtime/session/route.ts) where the policy
 * decision lives: when a visitor_id is asserted, we charge BOTH the user
 * bucket AND the IP bucket so a hostile visitor can't rotate IDs to bypass
 * the rate limit.
 */
export function bucketKeyFromRequest(req: Request): string {
  const headers = req.headers;
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return `ip:${first}`;
  }
  const xri = headers.get("x-real-ip");
  if (xri) return `ip:${xri.trim()}`;
  const cf = headers.get("cf-connecting-ip");
  if (cf) return `ip:${cf.trim()}`;
  return "ip:unknown";
}

export type QuotaResult = {
  allowed: boolean;
};

/**
 * Atomically check ONE OR TWO buckets and allow the request only if BOTH
 * would stay within the configured per-minute and per-day caps. When both
 * pass, increments both. When either would exceed, increments NEITHER —
 * critical for the Layer 2 case: an exhausted user retrying must not
 * cascade-burn the shared IP bucket (and vice versa).
 *
 * Single-bucket use: pass null for secondaryBucket. Behavior degrades
 * gracefully to peek-then-commit on just the primary.
 *
 * Fails closed on RPC error — better to block than to leak a billable
 * OpenAI session through.
 */
export async function consumeQuota(args: {
  widgetId: string;
  primaryBucket: string;
  secondaryBucket?: string | null;
  minuteLimit: number;
  dayLimit: number;
}): Promise<QuotaResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("consume_dual_quota", {
    p_widget_id: args.widgetId,
    p_primary_bucket: args.primaryBucket,
    p_secondary_bucket: args.secondaryBucket ?? null,
    p_minute_limit: args.minuteLimit,
    p_day_limit: args.dayLimit,
  });

  if (error || !data || !Array.isArray(data) || data.length === 0) {
    return { allowed: false };
  }

  return { allowed: Boolean((data[0] as { allowed?: unknown }).allowed) };
}
