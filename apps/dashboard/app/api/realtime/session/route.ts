import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import type { WidgetRow } from "@/lib/supabase/types";
import { corsHeaders, SENTINEL_ID, uniformNotFound } from "@/lib/api/cors";
import { bucketKeyFromRequest, consumeQuota } from "@/lib/quotas";

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

const bodySchema = z.object({ widget_id: z.uuid() });

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
- After a tool error ({ok:false}), try one alternative selector from the snapshot. If still failing, say so in one short sentence.

## When user just chats (greetings, questions about the page):
- Respond naturally without tools. Keep it short.
- If they ask "what's on the page" or similar, summarize from the snapshot text — do NOT call read_page again.

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

  // Quota check (Layer 1). Bucket by IP for v1; Layer 2 will accept an
  // operator-asserted user identifier and bucket per-user instead.
  const quota = await consumeQuota({
    widgetId: data.id,
    bucketKey: bucketKeyFromRequest(req),
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
        // Combine the built-in agent behavior (hard rules about tool use,
        // snapshot reliance, no-hallucination) with the operator's
        // personality/domain prompt. Operator content is appended so it
        // cannot override the hard rules above it.
        instructions: DEFAULT_AGENT_PROMPT + (data.system_prompt ?? ""),
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
  return NextResponse.json(json, {
    headers: { ...corsHeaders(origin), "Cache-Control": "no-store" },
  });
}
