import { createAdminClient } from "@/lib/supabase/server";

/**
 * Bucket key for quota counting. v1 buckets by IP only; Layer 2 will switch
 * to operator-asserted user identity (`user:<id>`) when present.
 *
 * IP extraction goes through Vercel / standard proxies in this order:
 *   1. x-forwarded-for first hop
 *   2. x-real-ip
 *   3. cf-connecting-ip (Cloudflare)
 *   4. fallback "unknown"
 *
 * "unknown" still gets bucketed — many requests with no resolvable IP would
 * pile into one bucket and block each other, which is the safer failure mode
 * than letting them all through.
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
  minute_count: number;
  day_count: number;
};

/**
 * Atomically increment usage counters for this widget+bucket and return
 * whether this request is within the configured per-minute and per-day caps.
 * The increment happens regardless of the result — once over the limit in a
 * window, the bucket stays blocked until the window rolls over.
 */
export async function consumeQuota(args: {
  widgetId: string;
  bucketKey: string;
  minuteLimit: number;
  dayLimit: number;
}): Promise<QuotaResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("consume_quota", {
    p_widget_id: args.widgetId,
    p_bucket_key: args.bucketKey,
    p_minute_limit: args.minuteLimit,
    p_day_limit: args.dayLimit,
  });

  if (error || !data || !Array.isArray(data) || data.length === 0) {
    // Fail closed on RPC error — better to block than to leak a billable
    // OpenAI session through.
    return { allowed: false, minute_count: -1, day_count: -1 };
  }

  const row = data[0] as {
    allowed: boolean;
    minute_count: number;
    day_count: number;
  };
  return row;
}
