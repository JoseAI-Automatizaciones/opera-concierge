import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import type { WidgetRow } from "@/lib/supabase/types";
import { corsHeaders, SENTINEL_ID, uniformNotFound } from "@/lib/api/cors";
import { bucketKeyFromRequest, consumeQuota } from "@/lib/quotas";
import { verifyVisitorJwt, mintSessionCapability } from "@/lib/jwt";

/**
 * POST /api/realtime/session
 * Body: { widget_id: string }
 *
 * Mints an ephemeral OpenAI Realtime client secret for the embedded widget
 * to open a WebRTC session directly with OpenAI. The server NEVER hands out
 * the long-lived OPENAI_API_KEY — only short-lived tokens scoped to a single
 * session configuration.
 *
 * Authorization: requesting origin must be allowlisted for the widget.
 * Quota: per-widget per-bucket (IP today) caps enforced atomically BEFORE
 * we mint the token, so an attacker cannot rack up OpenAI billing.
 * All failure paths return a timing-uniform 404 with no body, EXCEPT quota
 * exhaustion which returns a clear 429 with `Retry-After`.
 */

/** Operator-asserted visitor identity. The widget reads this from
 *  data-opera-user-id and forwards it. We mirror the widget's tight
 *  allowlist server-side so a malicious page can't poison the bucket
 *  key column with whitespace, slashes, etc. */
const VISITOR_ID_PATTERN = /^[A-Za-z0-9._\-:@]{1,128}$/;

const bodySchema = z.object({
  widget_id: z.uuid(),
  visitor_id: z
    .string()
    .regex(VISITOR_ID_PATTERN, "invalid_visitor_id")
    .optional(),
  /** HS256 JWT issued by the operator's backend (Layer 2 signed mode).
   *  Three base64url segments separated by dots. We bound the length to
   *  guard against absurd payloads — real visitor-identity JWTs are
   *  comfortably under 1 KB. */
  visitor_token: z
    .string()
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "invalid_visitor_token")
    .max(2048)
    .optional(),
});

const REALTIME_ENDPOINT = "https://api.openai.com/v1/realtime/client_secrets";

/**
 * Built-in agent behavior. Server-side and immutable — operators can NOT
 * weaken it, only add personality / domain context on top via their own
 * system_prompt. This is the "Opera knows how to operate websites"
 * contract: deterministic rules about tool use, snapshot reliance, no
 * hallucinated confirmations, etc.
 *
 * Keep this concise — model context is finite and the operator's prompt
 * follows. Aim for the rules that prevent the failure modes we've actually
 * seen in testing (hallucinated confirmations, asking instead of acting,
 * picking the wrong product when ambiguous, etc.).
 */
const DEFAULT_AGENT_PROMPT = `You are a voice concierge operating the current web page. The widget injects a PAGE_SNAPSHOT message listing every interactive element on the page. Each element has a 'ref' handle (e.g. "e12"), its tag, visible text, and surrounding container context (product names, prices, accessibility hints, data-* attributes).

## Hard rules (DO NOT VIOLATE):
1. NEVER confirm an action ("done", "added", "listo", "filtered", "removed") without having called the corresponding tool AND received {ok:true}. Confirming without a tool call is lying. If unsure, call the tool.
2. EXECUTE — do not narrate. Skip phrases like "I'll", "let me", "give me a moment", "voy a", "déjame", "un momento". Just call the tool, then confirm in 2-5 words.
3. If the user's request uniquely matches ONE item in the snapshot (by name fragment, price, or other property), act on it — do not ask "which one". Only ask when truly ambiguous (2+ items match equally well).
4. Pass the 'ref' handle from the snapshot to click_element / fill_field / scroll_to_element (e.g. {"ref":"e12"}). Do NOT pass CSS selectors. Do NOT invent refs — only use refs that appear in the snapshot or in a tool's page_after result.
5. Do not call read_page again — every successful click_element/fill_field result includes a 'page_after' field with a DELTA: { added: [...new elements...], removed: ["e7", ...], changed: [...elements whose state changed...], unchanged_count: N, total: N }. Apply this delta against your mental model of the page:
   - 'added' items have NEW refs — use them for next-step actions.
   - 'removed' refs no longer exist — never call tools on them.
   - 'changed' items keep the SAME ref but their state (text/disabled/checked/value) has updated. Trust the new state.
   - Refs not mentioned in the diff are unchanged from before. They keep their refs and are still valid for tool calls.
   - Refs are MONOTONIC and STABLE across snapshots — "e12" always means the same element until it shows up in 'removed'.

## Action mapping (always pass {ref: "eN"} from the snapshot):
- "Add X to cart" → click_element on the element whose data-action="add" (or text matches "add to cart" / "añadir") AND whose context contains the product name X.
- "Remove X" → click_element on data-action="remove" matching X.
- "Filter cheaper / cheapest" → click_element on data-filter="cheap" or equivalent.
- "Filter newer / newest" → click_element on data-filter="new".
- "Sort by price ascending/descending" → click_element on data-sort="price-asc" or "price-desc".
- "Search [text]" → fill_field on the search input (name or id contains "search"), passing {ref, value}.
- "Checkout / finalize purchase" → click_element on the element with text containing "checkout" / "finalizar".
- Price predicates ("under $X", "below $Y", "barato"): scan prices in interactive items' context, identify matches, act.

## Style:
- Confirmations: 2-5 words. "Done", "Added", "Filtered", "Removed". Use the user's language.
- Speak ONLY the user's language. Detect from the first message. Default Spanish if ambiguous.
- After a tool error ({ok:false}), inspect the page_after diff (or the original snapshot) for a different ref that better matches the user's request, and try that ref. If two attempts still fail, say so in one short sentence.

## When user just chats (greetings, questions about the page):
- Respond naturally without tools. Keep it short.
- If they ask "what's on the page" or similar, summarize from the snapshot text — do NOT call read_page again.

## Custom HTTP tools (when present):
Some sessions include operator-defined tools beyond the built-in DOM set (e.g. lookup_order, check_balance). These tools call the operator's backend, return JSON. Use them when the user's request needs operator data (order status, account info, inventory) that isn't on the page. Their parameters and descriptions are shown in your tools list — call them exactly like a built-in. Result shape: { ok: boolean, status?: number, body: ... }. If ok=false, tell the user briefly that you couldn't reach the service.

---

## Operator-defined personality and domain:
`;

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");

  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }
  const parsed = bodySchema.safeParse(raw);
  const lookupId = parsed.success ? parsed.data.widget_id : SENTINEL_ID;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("widgets")
    .select("*")
    .eq("id", lookupId)
    .maybeSingle<WidgetRow>();

  if (!parsed.success || error || !data) return uniformNotFound(origin);
  if (!origin || !data.allowed_origins.includes(origin)) {
    return uniformNotFound(origin);
  }

  // Resolve visitor identity. Two layers:
  //   1. Signed mode (preferred when configured): the widget row has a
  //      visitor_jwt_secret, and the request body carries a JWT that
  //      verifies against it. The JWT's `sub` claim becomes the visitor.
  //      data-opera-user-id is IGNORED in this mode — once signing is
  //      enabled the operator's explicit intent is "only trust JWTs".
  //   2. Unsigned fallback: no JWT secret on the widget → accept the
  //      raw visitor_id from the body if present.
  //
  // If signed mode is configured but the JWT is missing or invalid, we
  // collapse to the uniform 404 to avoid leaking "this widget requires
  // JWT" as a side channel. Operators see the failure in their browser
  // console + can verify with the integration sample code.
  // Track verified vs unverified separately. Both feed the agent's
  // instructions block, but ONLY the verified value is allowed to be
  // bound into the tool-call capability — otherwise the proxy would
  // forward a forgeable unsigned id under the trusted X-Opera-Visitor
  // header to operator backends.
  let visitorId: string | null = null;
  let verifiedVisitorSub: string | null = null;
  if (parsed.success) {
    if (data.visitor_jwt_secret) {
      const token = parsed.data.visitor_token;
      if (!token) return uniformNotFound(origin);
      const result = await verifyVisitorJwt(token, data.visitor_jwt_secret);
      if (!result.ok) return uniformNotFound(origin);
      visitorId = result.sub;
      verifiedVisitorSub = result.sub;
    } else if (parsed.data.visitor_id) {
      visitorId = parsed.data.visitor_id;
    }
  }

  // Quota check. Charge BOTH ip:<addr> AND user:<id> when visitor_id is
  // present. consume_dual_quota peeks both atomically and increments
  // NEITHER when either would fail — prevents rotation attacks AND
  // cross-bucket cascade burns. See migration 20260517000001.
  const quota = await consumeQuota({
    widgetId: data.id,
    primaryBucket: bucketKeyFromRequest(req),
    secondaryBucket: visitorId ? `user:${visitorId}` : null,
    minuteLimit: data.max_sessions_per_minute,
    dayLimit: data.max_sessions_per_day,
  });
  if (!quota.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: {
          ...corsHeaders(origin),
          // 60s is conservative: minute window rolls every 60s, day window
          // every 24h. Most rejections will be the minute window.
          "Retry-After": "60",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // OpenAI key is per-widget — the operator supplies it via the dashboard
  // when creating the widget. We DO NOT fall back to a global env var,
  // because each widget can use a different operator's OpenAI account.
  const apiKey = data.openai_api_key;
  if (!apiKey) {
    return NextResponse.json(
      { error: "widget_openai_key_not_configured" },
      { status: 503, headers: corsHeaders(origin) }
    );
  }

  // Token-policy boundary (best effort — see CLAUDE.md):
  //   - expires_after: short validity for the client_secret so a leaked
  //     token cannot be reused outside its intended session-startup window.
  //   - max_output_tokens: per-response token cap at mint time. The client
  //     can override via session.update once connected, so this bounds the
  //     well-behaved-client cost. Real billing protection is Layer 1 quotas
  //     plus the operator's OpenAI account spending cap.
  let instructions = DEFAULT_AGENT_PROMPT + (data.system_prompt ?? "");
  if (visitorId) {
    // Append visitor identity AFTER the operator prompt so personality
    // hints (e.g. "address by first name") can still influence behavior.
    // Do NOT instruct the model to read the ID aloud — IDs are commonly
    // numeric / opaque and leaking them in voice is a privacy footgun.
    instructions +=
      `\n\n## Visitor\nThe operator's frontend has identified this visitor as "${visitorId}" (unsigned assertion). Use it for context if their personality prompt suggests how; do NOT read the raw ID aloud.`;
  }

  const upstream = await fetch(REALTIME_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 120 },
      session: {
        type: "realtime",
        model: data.llm_model,
        instructions,
        audio: { output: { voice: data.voice } },
        max_output_tokens: data.max_response_output_tokens,
      },
    }),
  });

  if (!upstream.ok) {
    return NextResponse.json(
      { error: "session_mint_failed" },
      { status: 502, headers: corsHeaders(origin) }
    );
  }

  const json = await upstream.json();

  // Mint a session-binding capability the widget will present on every
  // /api/tools/call. TTL matches the widget's wall-clock session cap
  // (+ 60s slack) so custom tools keep working for the full session.
  // The capability is bound to this widget_id; see lib/jwt.ts for the
  // full threat-model writeup (it provides session binding + audit, not
  // arg authentication — operators MUST validate tool args).
  let operaSessionToken: string | null = null;
  try {
    operaSessionToken = await mintSessionCapability(
      data.id,
      Math.min(data.max_session_seconds + 60, 7260),
      // Only the JWT-verified sub crosses into the capability. An unsigned
      // visitor_id MUST NOT be promoted here — that would make the proxy
      // forward an attacker-controlled value under the trusted
      // X-Opera-Visitor header.
      verifiedVisitorSub
    );
  } catch {
    // Capability minting failure shouldn't block the realtime session
    // itself — custom tools simply won't work this round.
  }

  return NextResponse.json(
    { ...json, opera_session_token: operaSessionToken },
    { headers: { ...corsHeaders(origin), "Cache-Control": "no-store" } }
  );
}
