/**
 * Tool registry — schema definitions sent to OpenAI Realtime via session.update,
 * plus the dispatcher that maps incoming function calls to local implementations.
 *
 * Schemas follow OpenAI Realtime's `tools` array shape:
 *   { type: "function", name, description, parameters: JSONSchema }
 */
import {
  findElements,
  clickElement,
  fillField,
  scrollToElement,
  readPage,
  navigateTo,
  interactiveSnapshotDiff,
} from "./dom";

/** Tools that may have changed the DOM in-place — their results get a
 *  fresh interactive snapshot appended so the model sees the updated page
 *  without needing a separate read_page round-trip. navigate_to is
 *  deliberately excluded: it's a full page navigation, so any snapshot
 *  we'd attach would either be the unloading old page or never returned
 *  in time before the route changes. */
const STATE_CHANGING_TOOLS = new Set([
  "click_element",
  "fill_field",
]);

/** Wait for two animation frames so framework re-renders (React, Vue,
 *  etc.) commit before we snapshot the post-action DOM. One frame is
 *  enough for vanilla pages; the second covers libraries that batch
 *  state updates into a microtask after the first paint. */
function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export type RealtimeToolDef = {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export const toolDefinitions: RealtimeToolDef[] = [
  {
    type: "function",
    name: "find_elements",
    description:
      "Search the visible page for elements matching either a piece of visible text OR a CSS selector. Returns up to 8 matches as ref handles (e.g. 'e42') with tag and visible text snippet. Use the ref in click_element/fill_field/scroll_to_element. Usually not needed — the PAGE_SNAPSHOT already lists every interactive element.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Either a substring of visible text (e.g. 'Add to cart') or a CSS selector (e.g. 'button.checkout').",
        },
        limit: {
          type: "integer",
          description: "Maximum number of matches to return (default 8, max 8).",
        },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "click_element",
    description:
      "Click an element. Prefer the `ref` form using a handle from PAGE_SNAPSHOT or page_after (e.g. 'e12'). CSS selectors are accepted as a fallback when no ref is available.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Ref handle from the snapshot, e.g. 'e12'." },
        selector: { type: "string", description: "CSS selector — only when no ref is available." },
      },
    },
  },
  {
    type: "function",
    name: "fill_field",
    description:
      "Fill a text input or textarea with a value. Prefer the `ref` form using a handle from the snapshot. Password and credit-card fields are refused for safety.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Ref handle from the snapshot, e.g. 'e12'." },
        selector: { type: "string", description: "CSS selector — only when no ref is available." },
        value: { type: "string", description: "Value to enter." },
      },
      required: ["value"],
    },
  },
  {
    type: "function",
    name: "scroll_to_element",
    description: "Smoothly scroll the page so the given element is centered in the viewport. Prefer the `ref` form.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Ref handle from the snapshot, e.g. 'e12'." },
        selector: { type: "string", description: "CSS selector — only when no ref is available." },
      },
    },
  },
  {
    type: "function",
    name: "read_page",
    description:
      "Read the page in ONE call: returns visible text PLUS a structured list of interactive elements (buttons, links, inputs, anything with data-action/data-product-id/data-filter/data-sort) each with its CSS selector. Use this once at the start of a session to learn what's on the page, then call click_element / fill_field directly with the selectors returned here — DO NOT call find_elements again unless read_page didn't include what you need.",
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "Optional CSS selector of a region. If omitted, reads <body>.",
        },
        max_chars: {
          type: "integer",
          description: "Cap on returned characters (default 2000, max 2000).",
        },
      },
    },
  },
  {
    type: "function",
    name: "navigate_to",
    description:
      "Navigate the page to a URL on the SAME origin as the current page. Cross-origin navigation is blocked.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute or relative URL." },
      },
      required: ["url"],
    },
  },
];

/** Dispatch a tool call by name. Async because state-changing tools wait
 *  for the host page to re-render before snapshotting the post-action DOM
 *  into the result. Unknown tools return a structured error. */
export async function dispatchTool(name: string, args: unknown): Promise<unknown> {
  const a = (args && typeof args === "object" ? args : {}) as Record<
    string,
    unknown
  >;

  let result: unknown;
  switch (name) {
    case "find_elements":
      result = findElements(a);
      break;
    case "click_element":
      result = clickElement(a);
      break;
    case "fill_field":
      result = fillField(a);
      break;
    case "scroll_to_element":
      result = scrollToElement(a);
      break;
    case "read_page":
      result = readPage(a);
      break;
    case "navigate_to":
      result = navigateTo(a);
      break;
    default:
      result = { ok: false, error: "unknown_tool", tool: name };
  }

  // For state-changing tools that succeeded, wait one paint cycle for the
  // host page's framework to commit its DOM update, THEN compute a DIFF
  // against the model's previous view of the page. The diff (added /
  // removed / changed / unchanged_count) is much smaller than a fresh
  // full snapshot when the page only mutated a little (which is the
  // common case after a filter or a single add-to-cart click).
  if (
    STATE_CHANGING_TOOLS.has(name) &&
    result &&
    typeof result === "object" &&
    (result as { ok?: boolean }).ok === true
  ) {
    try {
      await waitForPaint();
      (result as Record<string, unknown>).page_after = interactiveSnapshotDiff();
    } catch {
      // Snapshot is best-effort.
    }
  }

  // Diagnostic log — visible in the host page's DevTools console so the
  // operator can see whether the model is actually calling tools (and with
  // what args) when something appears not to work.
  // eslint-disable-next-line no-console
  console.log("[opera-concierge] tool:", name, "args:", a, "→", result);
  return result;
}
