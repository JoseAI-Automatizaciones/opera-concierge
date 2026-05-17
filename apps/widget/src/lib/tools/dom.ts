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

/**
 * True if the element is inside a sensitive context — login forms, payment
 * forms, OTP entry boxes. We refuse to surface OR actuate elements in this
 * context, even ones that aren't themselves password fields: the "Submit"
 * button of a login form is off-limits because activating it relies on
 * credentials the agent shouldn't be touching.
 *
 * Rule: if the enclosing <form> (or the closest [data-opera-private]
 * container) contains ANY protected field, the entire form is off-limits.
 */
function isInsideProtectedContext(el: Element): boolean {
  if (isProtectedField(el)) return true;
  const enclosing = el.closest("form, [data-opera-private]");
  if (!enclosing) return false;
  if (enclosing.hasAttribute("data-opera-private")) return true;
  return Boolean(enclosing.querySelector(PROTECTED_SELECTOR));
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
 * Build a CSS selector that targets exactly one element. Prefers stable
 * attribute-based selectors (id, data-*, name) over positional chains so
 * the selector survives page re-renders, sorting, and filtering. Falls
 * back to a tag + nth-of-type chain only when nothing stable is unique.
 */
function buildSelector(el: Element, depth = 0): string {
  if (depth > 5 || el === document.documentElement)
    return el.tagName.toLowerCase();

  const tag = el.tagName.toLowerCase();

  // 1. #id if unique.
  if (el.id) {
    const candidate = `#${CSS.escape(el.id)}`;
    try {
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    } catch {
      // Fall through.
    }
  }

  // 2. tag[attr="value"] for stable attributes that uniquely identify.
  //    Tried in priority order — data-testid is the most explicit signal
  //    of "this is a stable hook", followed by data-product-id and
  //    data-action+data-product-id combos, then name/aria-label.
  const stableAttrs = [
    "data-testid",
    "data-test-id",
    "data-test",
    "data-product-id",
    "data-id",
    "data-sku",
    "data-key",
    "name",
    "aria-label",
  ];
  for (const attr of stableAttrs) {
    const value = el.getAttribute(attr);
    if (!value) continue;
    const candidate = `${tag}[${attr}="${cssAttrEscape(value)}"]`;
    try {
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    } catch {
      // Skip invalid combos.
    }
  }

  // 3. Pair two data-* attributes when neither alone is unique — common in
  //    grids: data-action="add" + data-product-id="p3" → unique add button.
  const dataAttrs = el
    .getAttributeNames()
    .filter((n) => n.startsWith("data-"));
  if (dataAttrs.length >= 2) {
    // Try every pair (small set; at most ~6 data-* attrs in practice).
    for (let i = 0; i < dataAttrs.length; i++) {
      for (let j = i + 1; j < dataAttrs.length; j++) {
        const a = dataAttrs[i];
        const b = dataAttrs[j];
        const av = el.getAttribute(a);
        const bv = el.getAttribute(b);
        if (!av || !bv) continue;
        const candidate = `${tag}[${a}="${cssAttrEscape(av)}"][${b}="${cssAttrEscape(bv)}"]`;
        try {
          if (document.querySelectorAll(candidate).length === 1) return candidate;
        } catch {
          // Skip.
        }
      }
    }
  }

  // 4. Positional fallback — tag + nth-of-type relative to parent. Fragile
  //    across re-sorts but it's our last resort.
  const parent = el.parentElement;
  if (!parent) return tag;
  const siblings = Array.from(parent.children).filter(
    (c) => c.tagName === el.tagName
  );
  const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(el) + 1})` : "";
  return `${buildSelector(parent, depth + 1)} > ${tag}${nth}`;
}

function cssAttrEscape(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
  if (isInsideProtectedContext(el)) return { ok: false, error: "protected_context" };

  el.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "center" });
  pulseHighlight(el);
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
  if (isInsideProtectedContext(el)) return { ok: false, error: "protected_field" };
  if (
    !(el instanceof HTMLInputElement) &&
    !(el instanceof HTMLTextAreaElement)
  ) {
    return { ok: false, error: "not_a_text_input" };
  }

  el.focus();
  pulseHighlight(el);
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

/**
 * Brief outline + glow pulse on the element the agent just acted upon.
 * Gives the user an immediate visual ack of "yes, the agent did the thing"
 * — important because the verbal confirmation arrives 1-2s after the
 * action due to model audio generation latency.
 *
 * Implemented as an inline style with a CSS transition that we trigger by
 * toggling a marker class. The keyframes are injected once into the host
 * <head> on first use (idempotent), so we don't depend on the host page
 * shipping any CSS.
 */
function pulseHighlight(el: HTMLElement): void {
  injectHighlightKeyframes();
  el.classList.remove("opera-concierge-pulse");
  // Force a reflow so the animation restarts even on rapid repeat fires.
  void el.offsetWidth;
  el.classList.add("opera-concierge-pulse");
  // Clean up the class after the animation so we don't accumulate state.
  window.setTimeout(() => {
    el.classList.remove("opera-concierge-pulse");
  }, 900);
}

let keyframesInjected = false;
function injectHighlightKeyframes(): void {
  if (keyframesInjected) return;
  keyframesInjected = true;
  const style = document.createElement("style");
  style.setAttribute("data-opera-concierge", "highlight");
  style.textContent = `
    @keyframes opera-concierge-pulse-kf {
      0%   { box-shadow: 0 0 0 0 rgba(176, 138, 62, 0.0), 0 0 0 2px rgba(176, 138, 62, 0.0); }
      20%  { box-shadow: 0 0 0 8px rgba(176, 138, 62, 0.25), 0 0 0 2px rgba(176, 138, 62, 0.9); }
      100% { box-shadow: 0 0 0 16px rgba(176, 138, 62, 0.0), 0 0 0 2px rgba(176, 138, 62, 0.0); }
    }
    .opera-concierge-pulse {
      animation: opera-concierge-pulse-kf 800ms ease-out forwards;
      position: relative;
    }
  `;
  document.head.appendChild(style);
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

const MAX_INTERACTIVE = 40;

/**
 * Snapshot of just the interactive elements — used to refresh the model's
 * view of the page after an action that may have changed it (click on a
 * filter, add-to-cart, sort, etc.). Lighter than full readPage because we
 * skip the body text, which doesn't usually change in actionable ways.
 */
export function interactiveSnapshot(): Array<Record<string, string>> {
  const root = document.body;
  if (!root) return [];
  return Array.from(
    root.querySelectorAll(
      "button, a[href], [role='button'], [role='link'], input:not([type='hidden']), select, textarea, [data-action], [data-filter], [data-sort], [data-testid]"
    )
  )
    .filter((el) => isVisible(el) && !isInsideProtectedContext(el))
    .filter((el) => !el.closest("opera-concierge-root"))
    .slice(0, MAX_INTERACTIVE)
    .map(summarizeInteractive);
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
  // Remove the widget host outright.
  clone.querySelectorAll("opera-concierge-root").forEach((n) => n.remove());
  // Remove any <form> or [data-opera-private] container that holds a
  // protected field — strips not just the password input but every label,
  // hint, and adjacent button text that might leak credentials context to
  // the model. Then strip any straggling protected fields that weren't in
  // a form.
  clone.querySelectorAll("form, [data-opera-private]").forEach((container) => {
    if (
      container.hasAttribute("data-opera-private") ||
      container.querySelector(PROTECTED_SELECTOR)
    ) {
      container.remove();
    }
  });
  clone.querySelectorAll(PROTECTED_SELECTOR).forEach((n) => n.remove());

  const raw =
    (clone instanceof HTMLElement && clone.innerText) ||
    clone.textContent ||
    "";

  // Build a compact map of interactive elements with selectors, so the agent
  // can act in ONE round-trip instead of read_page → find_elements → click.
  // We work on the live document (not the clone) because we need real
  // selectors that resolve back to the actuating elements.
  const liveRoot = selector ? document.querySelector(selector) : document.body;
  const interactiveSet = liveRoot
    ? Array.from(
        liveRoot.querySelectorAll(
          "button, a[href], [role='button'], [role='link'], input:not([type='hidden']), select, textarea, [data-action], [data-filter], [data-sort], [data-testid]"
        )
      )
        .filter((el) => isVisible(el) && !isProtectedField(el))
        .filter((el) => !el.closest("opera-concierge-root"))
        .slice(0, MAX_INTERACTIVE)
        .map(summarizeInteractive)
    : [];

  return {
    ok: true,
    title: document.title,
    url: location.href,
    text: raw.replace(/\s+/g, " ").trim().slice(0, cap),
    interactive: interactiveSet,
  };
}

/**
 * Compact descriptor for an actionable element — enough for the model to
 * pick the right selector without a second tool call.
 *
 * Crucially we include the *container context* (the closest meaningful
 * ancestor's text and data-attributes). On a product grid the button text
 * is just "Add to cart" or "Añadir al carrito"; the product NAME and PRICE
 * live on the surrounding <article>. Without context the model has to
 * correlate raw page text with data-product-id values to decide which
 * button to click, which it does unreliably.
 */
function summarizeInteractive(el: Element) {
  const tag = el.tagName.toLowerCase();
  const ownText = ((el as HTMLElement).innerText ?? el.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const out: Record<string, string> = {
    tag,
    selector: buildSelector(el),
  };
  if (ownText) out.text = ownText.slice(0, 80);
  const aria = el.getAttribute("aria-label");
  if (aria) out.aria = aria.slice(0, 80);
  for (const attr of ["data-action", "data-product-id", "data-filter", "data-sort", "data-testid"]) {
    const v = el.getAttribute(attr);
    if (v) out[attr] = v.slice(0, 60);
  }
  if (el instanceof HTMLInputElement) {
    if (el.placeholder) out.placeholder = el.placeholder.slice(0, 60);
    if (el.name) out.name = el.name;
    out.input_type = el.type;
  }

  // Walk up to find a meaningful container: an element that is a semantic
  // "card" (article/li/section) OR carries its own data-* attributes. Use
  // its innerText minus the button's own text as `context`.
  const container = findContainer(el);
  if (container && container !== el) {
    const containerText = (
      (container as HTMLElement).innerText ??
      container.textContent ??
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
    // Subtract this element's own text so we don't repeat "Add to cart" twice.
    let context = ownText ? containerText.replace(ownText, "").trim() : containerText;
    context = context.replace(/\s+/g, " ").slice(0, 160);
    if (context) out.context = context;
    // Surface useful data-* attrs from the container too (e.g.
    // data-product-name="Auriculares inalámbricos" on the article).
    for (const attr of [
      "data-product-id",
      "data-product-name",
      "data-price",
      "data-id",
      "data-name",
    ]) {
      const v = container.getAttribute(attr);
      if (v && !out[attr]) out["container_" + attr] = v.slice(0, 80);
    }
  }
  return out;
}

function findContainer(el: Element): Element | null {
  let cur: Element | null = el.parentElement;
  let depth = 0;
  while (cur && depth < 6 && cur !== document.body) {
    const tag = cur.tagName.toLowerCase();
    if (tag === "article" || tag === "li" || tag === "section") return cur;
    // Any ancestor with its own data-* attribute is treated as a meaningful
    // container — covers card-style components that aren't semantic tags.
    for (const attr of cur.getAttributeNames()) {
      if (attr.startsWith("data-") && attr !== "data-action") return cur;
    }
    cur = cur.parentElement;
    depth++;
  }
  return null;
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
