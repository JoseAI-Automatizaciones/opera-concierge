/**
 * DOM tool implementations — executed on the host page from inside the widget.
 *
 * Universal fallback set: works on any website regardless of stack, by
 * operating on visible elements. Safety invariants enforced here:
 *
 * - Never read or fill password / OTP / credit-card / explicitly-marked
 *   private fields. Detection is layered: input type, autocomplete tokens,
 *   `data-opera-private` marker, and `contenteditable` (treated as opaque).
 * - Selectors used for actuation are uniqueness-checked — a stale or
 *   non-unique selector is rejected rather than silently targeting the wrong
 *   element.
 * - Navigation is restricted to same-origin URLs.
 * - Returned text is size-capped so a giant page can't blow up model context.
 * - readPage scrubs protected inputs by removing them from a DOM clone
 *   before extracting text, rather than string-replacing after the fact.
 */

const MAX_RESULTS = 8;
const MAX_TEXT_LENGTH = 2000;

/** Selectors that match any field we treat as protected. */
const PROTECTED_SELECTOR = [
  "input[type='password']",
  "input[autocomplete^='cc-']",
  "input[autocomplete='current-password']",
  "input[autocomplete='new-password']",
  "input[autocomplete='one-time-code']",
  "[data-opera-private]",
  "[contenteditable='true']",
  "[contenteditable='']",
].join(",");

function isProtectedField(el: Element): boolean {
  return el.matches(PROTECTED_SELECTOR);
}

function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  if (style.opacity === "0") return false;
  return true;
}

function summarize(el: Element): {
  tag: string;
  text: string;
  selector: string;
  role: string | null;
  href?: string;
} {
  const tag = el.tagName.toLowerCase();
  const text = ((el as HTMLElement).innerText ?? el.textContent ?? "")
    .trim()
    .slice(0, 160);
  const selector = buildSelector(el);
  const role = el.getAttribute("role");
  const out: ReturnType<typeof summarize> = { tag, text, selector, role };
  if (el instanceof HTMLAnchorElement && el.href) out.href = el.href;
  return out;
}

/**
 * Build a CSS selector that targets exactly one element. Falls back to a
 * tag-and-position chain if the id is non-unique. Capped depth so selectors
 * don't grow unbounded.
 */
function buildSelector(el: Element, depth = 0): string {
  if (depth > 5 || el === document.documentElement)
    return el.tagName.toLowerCase();

  if (el.id) {
    const candidate = `#${CSS.escape(el.id)}`;
    try {
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    } catch {
      // Fall through.
    }
  }

  const parent = el.parentElement;
  if (!parent) return el.tagName.toLowerCase();

  const tag = el.tagName.toLowerCase();
  const siblings = Array.from(parent.children).filter(
    (c) => c.tagName === el.tagName
  );
  const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(el) + 1})` : "";
  return `${buildSelector(parent, depth + 1)} > ${tag}${nth}`;
}

/** Resolve a selector to exactly ONE visible element, or null. */
function resolveSingle(selector: string): HTMLElement | null {
  let matches: NodeListOf<Element>;
  try {
    matches = document.querySelectorAll(selector);
  } catch {
    return null;
  }
  if (matches.length !== 1) return null;
  const el = matches[0];
  if (!(el instanceof HTMLElement)) return null;
  return el;
}

// ===== Tool implementations =====

export function findElements(args: unknown) {
  if (!isObject(args)) return { ok: false, error: "invalid_args" };
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return { ok: false, error: "missing_query" };
  const limit = Math.min(
    typeof args.limit === "number" ? args.limit : MAX_RESULTS,
    MAX_RESULTS
  );

  let matches: Element[] = [];
  try {
    const all = Array.from(document.querySelectorAll(query));
    matches = all.filter(isVisible).slice(0, limit);
  } catch {
    // Not a valid selector — fall through to text search.
  }

  if (matches.length === 0) {
    const lower = query.toLowerCase();
    const candidates = Array.from(
      document.querySelectorAll(
        "a, button, [role='button'], [role='link'], input, [data-testid], [aria-label]"
      )
    );
    matches = candidates
      .filter((el) => {
        if (!isVisible(el)) return false;
        const text = (
          (el as HTMLElement).innerText ||
          el.textContent ||
          el.getAttribute("aria-label") ||
          ""
        ).toLowerCase();
        return text.includes(lower);
      })
      .slice(0, limit);
  }

  return { ok: true, matches: matches.map(summarize) };
}

export function clickElement(args: unknown) {
  if (!isObject(args) || typeof args.selector !== "string") {
    return { ok: false, error: "invalid_args" };
  }
  const el = resolveSingle(args.selector);
  if (!el) return { ok: false, error: "not_found_or_ambiguous" };
  if (!isVisible(el)) return { ok: false, error: "not_visible" };

  el.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "center" });
  el.click();
  return { ok: true };
}

export function fillField(args: unknown) {
  if (
    !isObject(args) ||
    typeof args.selector !== "string" ||
    typeof args.value !== "string"
  ) {
    return { ok: false, error: "invalid_args" };
  }
  const el = resolveSingle(args.selector);
  if (!el) return { ok: false, error: "not_found_or_ambiguous" };
  if (isProtectedField(el)) return { ok: false, error: "protected_field" };
  if (
    !(el instanceof HTMLInputElement) &&
    !(el instanceof HTMLTextAreaElement)
  ) {
    return { ok: false, error: "not_a_text_input" };
  }

  el.focus();
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, args.value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true };
}

export function scrollToElement(args: unknown) {
  if (!isObject(args) || typeof args.selector !== "string") {
    return { ok: false, error: "invalid_args" };
  }
  const el = resolveSingle(args.selector);
  if (!el) return { ok: false, error: "not_found_or_ambiguous" };
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  return { ok: true };
}

export function readPage(args: unknown) {
  if (!isObject(args)) return { ok: false, error: "invalid_args" };
  const cap = Math.min(
    typeof args.max_chars === "number" ? args.max_chars : MAX_TEXT_LENGTH,
    MAX_TEXT_LENGTH
  );
  const selector = typeof args.selector === "string" ? args.selector : null;

  const root = selector ? document.querySelector(selector) : document.body;
  if (!root) return { ok: false, error: "not_found" };

  // Clone the subtree, strip protected inputs/contenteditable regions and the
  // widget's own shadow host, then read innerText. This actually removes the
  // sensitive nodes so neither .value nor descendant text survives.
  const clone = root.cloneNode(true) as Element;
  clone
    .querySelectorAll(PROTECTED_SELECTOR + ", opera-concierge-root")
    .forEach((node) => node.remove());

  // Cloned nodes aren't in the live document so innerText falls back to
  // textContent in some browsers; that's fine for our purposes.
  const raw =
    (clone instanceof HTMLElement && clone.innerText) ||
    clone.textContent ||
    "";

  return {
    ok: true,
    title: document.title,
    url: location.href,
    text: raw.replace(/\s+/g, " ").trim().slice(0, cap),
  };
}

export function navigateTo(args: unknown) {
  if (!isObject(args) || typeof args.url !== "string") {
    return { ok: false, error: "invalid_args" };
  }
  let target: URL;
  try {
    target = new URL(args.url, location.href);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (target.origin !== location.origin) {
    return { ok: false, error: "cross_origin_blocked" };
  }
  location.assign(target.href);
  return { ok: true };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}
