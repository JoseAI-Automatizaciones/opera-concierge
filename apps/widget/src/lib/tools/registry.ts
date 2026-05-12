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
} from "./dom";

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
      "Search the visible page for elements matching a CSS selector OR a piece of visible text. Returns up to 8 matches with tag, visible text snippet, and a stable selector you can use with other tools.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Either a CSS selector (e.g. 'button.checkout') or a substring of visible text (e.g. 'Add to cart').",
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
      "Click an element identified by a CSS selector returned from find_elements.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Stable CSS selector." },
      },
      required: ["selector"],
    },
  },
  {
    type: "function",
    name: "fill_field",
    description:
      "Fill a text input or textarea with a value. Password and credit-card fields are refused for safety.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Stable CSS selector of the input." },
        value: { type: "string", description: "Value to enter." },
      },
      required: ["selector", "value"],
    },
  },
  {
    type: "function",
    name: "scroll_to_element",
    description: "Smoothly scroll the page so the given element is centered in the viewport.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Stable CSS selector." },
      },
      required: ["selector"],
    },
  },
  {
    type: "function",
    name: "read_page",
    description:
      "Read the visible text from the page or a specific region. Use this to understand what the user is looking at before deciding what to do.",
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

/** Dispatch a tool call by name. Unknown tools return a structured error. */
export function dispatchTool(name: string, args: unknown): unknown {
  const a = (args && typeof args === "object" ? args : {}) as Record<
    string,
    unknown
  >;

  switch (name) {
    case "find_elements":
      return findElements(a as { query: string; limit?: number });
    case "click_element":
      return clickElement(a as { selector: string });
    case "fill_field":
      return fillField(a as { selector: string; value: string });
    case "scroll_to_element":
      return scrollToElement(a as { selector: string });
    case "read_page":
      return readPage(a as { selector?: string; max_chars?: number });
    case "navigate_to":
      return navigateTo(a as { url: string });
    default:
      return { ok: false, error: "unknown_tool", tool: name };
  }
}
