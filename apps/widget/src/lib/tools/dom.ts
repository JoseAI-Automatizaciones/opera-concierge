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

/**
 * Integer-ref scheme (inspired by browser-use & vercel-labs/agent-browser).
 *
 * Instead of sending CSS selectors to the LLM, we hand it short integer
 * handles like "e12". The widget keeps a Map<ref, Element> internally and
 * resolves the handle back to the live DOM node when the model calls a
 * tool. Three wins:
 *   - ~50% fewer tokens in the page snapshot (selectors are verbose).
 *   - Voice models stop hallucinating selector syntax.
 *   - Re-renders that detach the node fall back to the stable CSS selector
 *     we cached at assignment time.
 *
 * Refs are monotonic across the session (e1, e2, … never reused) so that
 * a previously-issued ref stays valid even after a fresh snapshot. We cap
 * map growth at MAX_REF_MAP_SIZE by evicting the oldest entries.
 */
const MAX_REF_MAP_SIZE = 500;

type RefEntry = {
  /** WeakRef so we don't pin removed DOM nodes in memory. */
  weak: WeakRef<HTMLElement>;
  /** Fallback selector cached at assignment time — used if the WeakRef
   *  is dead OR the node was detached/re-rendered by the host. */
  selector: string;
};

const refMap = new Map<string, RefEntry>();
/** Reverse lookup: live Element → its ref. Lets us re-use refs across
 *  re-snapshots so the model can correctly receive a diff like
 *  `removed: ["e7"]` when the SAME element keeps the SAME ref across
 *  snapshots. Without this, every rebuild assigned fresh refs and the
 *  diff would always be "everything removed, everything added". */
const elementToRef = new WeakMap<Element, string>();
let refCounter = 0;

function assignRef(el: HTMLElement): string {
  refCounter += 1;
  const id = `e${refCounter}`;
  refMap.set(id, { weak: new WeakRef(el), selector: buildSelector(el) });
  elementToRef.set(el, id);
  // Evict oldest entries when over cap. Map iteration order is insertion
  // order, so .keys().next().value is the oldest.
  while (refMap.size > MAX_REF_MAP_SIZE) {
    const oldest = refMap.keys().next().value;
    if (!oldest) break;
    refMap.delete(oldest);
  }
  return id;
}

/** Get the element's existing ref if it has one and that ref is still
 *  alive in refMap; otherwise mint a new ref. Used by the snapshot
 *  builders so the SAME element keeps the SAME ref across re-snapshots. */
function getOrAssignRef(el: HTMLElement): string {
  const existing = elementToRef.get(el);
  if (existing && refMap.has(existing)) {
    // Refresh the WeakRef in case GC was about to claim it.
    const entry = refMap.get(existing)!;
    if (!entry.weak.deref()) {
      refMap.set(existing, { weak: new WeakRef(el), selector: entry.selector });
    }
    return existing;
  }
  return assignRef(el);
}

/** Resolve an LLM-supplied ref back to a live element. Returns null if
 *  the ref was never issued, the element is gone, AND the cached
 *  selector no longer resolves uniquely. */
function resolveRef(ref: string): HTMLElement | null {
  const entry = refMap.get(ref);
  if (!entry) return null;
  const live = entry.weak.deref();
  if (live && document.contains(live)) return live;
  // Node was detached or GC'd — try the cached CSS selector as a fallback.
  const fallback = resolveSingle(entry.selector);
  if (fallback) {
    // Re-cache so we don't keep doing the re-query.
    refMap.set(ref, { weak: new WeakRef(fallback), selector: entry.selector });
    return fallback;
  }
  return null;
}

/** Resolve a tool's target element from either a ref (preferred) or a
 *  raw CSS selector (fallback for callers who didn't get a ref). Returns
 *  the element + the input shape used for error reporting. */
function resolveTarget(args: Record<string, unknown>): {
  el: HTMLElement | null;
  via: "ref" | "selector" | "none";
} {
  if (typeof args.ref === "string" && args.ref) {
    return { el: resolveRef(args.ref), via: "ref" };
  }
  if (typeof args.selector === "string") {
    return { el: resolveSingle(args.selector), via: "selector" };
  }
  return { el: null, via: "none" };
}

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
  if (!isObject(args)) return { ok: false, error: "invalid_args" };
  const { el, via } = resolveTarget(args);
  if (via === "none") return { ok: false, error: "missing_ref_or_selector" };
  if (!el) return { ok: false, error: "not_found_or_ambiguous" };
  if (!isVisible(el)) return { ok: false, error: "not_visible" };
  if (isInsideProtectedContext(el)) return { ok: false, error: "protected_context" };

  el.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "center" });
  pulseHighlight(el);
  el.click();
  return { ok: true };
}

export function fillField(args: unknown) {
  if (!isObject(args) || typeof args.value !== "string") {
    return { ok: false, error: "invalid_args" };
  }
  const { el, via } = resolveTarget(args);
  if (via === "none") return { ok: false, error: "missing_ref_or_selector" };
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
  if (!isObject(args)) return { ok: false, error: "invalid_args" };
  const { el, via } = resolveTarget(args);
  if (via === "none") return { ok: false, error: "missing_ref_or_selector" };
  if (!el) return { ok: false, error: "not_found_or_ambiguous" };
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  return { ok: true };
}

const MAX_INTERACTIVE = 40;

/**
 * Single broad query for "interactive" elements. Three buckets:
 *  - Native interactive tags: button, a[href], input, select, textarea
 *  - ARIA-role hooks: role=button / link / menuitem / option / checkbox / tab
 *  - Custom-attribute hooks: data-action / data-filter / data-sort / data-testid
 *    / data-product-id / data-id, plus inline onclick or focusable
 *    tabindex (modern SPAs put behavior on <div onClick>).
 *
 * Worth noting: we intentionally do NOT scan cursor:pointer via
 * getComputedStyle. That would force a layout pass over the entire
 * document, which on big product pages takes 100-300ms. The patterns
 * above cover ~95% of real-world clickables.
 */
const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='option']",
  "[role='checkbox']",
  "[role='switch']",
  "[role='tab']",
  "[role='radio']",
  "[data-action]",
  "[data-filter]",
  "[data-sort]",
  "[data-testid]",
  "[data-product-id]",
  "[data-id]",
  "[onclick]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Build the raw interactive-element list. Does not record state. */
function buildInteractive(): Array<Record<string, string>> {
  const root = document.body;
  if (!root) return [];
  return Array.from(root.querySelectorAll(INTERACTIVE_SELECTOR))
    .filter((el) => isVisible(el) && !isInsideProtectedContext(el))
    .filter((el) => !el.closest("opera-concierge-root"))
    .slice(0, MAX_INTERACTIVE)
    .map(summarizeInteractive);
}

/**
 * Cache of the most recent snapshot's signatures, keyed by ref. Used by
 * interactiveSnapshotDiff to compute the delta against the previous view
 * the model has. Reset whenever a fresh full snapshot is recorded.
 */
let lastSnapshot = new Map<string, string>();

function signature(item: Record<string, string>): string {
  return JSON.stringify(item);
}

function recordSnapshot(items: Array<Record<string, string>>): void {
  lastSnapshot = new Map(items.map((it) => [it.ref, signature(it)]));
}

/**
 * Full snapshot — returns every visible interactive element. Records the
 * state internally so the next interactiveSnapshotDiff() can compute its
 * delta against this view. Called from readPage and the initial widget
 * snapshot injection.
 */
export function interactiveSnapshot(): Array<Record<string, string>> {
  const items = buildInteractive();
  recordSnapshot(items);
  return items;
}

/**
 * Delta snapshot — what changed since the model last saw the page.
 *   added:   refs that appeared (full element entries)
 *   removed: refs that disappeared (just the ref strings)
 *   changed: refs whose properties changed (full new element entries)
 *   unchanged_count: how many refs stayed identical (count only)
 *   total:   total interactive items currently on the page
 *
 * After computing, lastSnapshot is updated to the current state so the
 * next call diffs against THIS state, not the original. If churn is high
 * (>60% of refs changed/added/removed), callers may prefer to ignore the
 * diff and re-request a full read_page, but in practice the diff format
 * handles full reloads fine — every old ref ends up in `removed`, every
 * new one in `added`.
 */
export type InteractiveDiff = {
  added: Array<Record<string, string>>;
  removed: string[];
  changed: Array<Record<string, string>>;
  unchanged_count: number;
  total: number;
};

export function interactiveSnapshotDiff(): InteractiveDiff {
  const items = buildInteractive();
  const newByRef = new Map<string, Record<string, string>>();
  const newSigs = new Map<string, string>();
  for (const it of items) {
    newByRef.set(it.ref, it);
    newSigs.set(it.ref, signature(it));
  }

  const added: Array<Record<string, string>> = [];
  const changed: Array<Record<string, string>> = [];
  let unchanged = 0;
  for (const [ref, sig] of newSigs) {
    const prev = lastSnapshot.get(ref);
    if (prev === undefined) {
      added.push(newByRef.get(ref)!);
    } else if (prev !== sig) {
      changed.push(newByRef.get(ref)!);
    } else {
      unchanged += 1;
    }
  }
  const removed: string[] = [];
  for (const ref of lastSnapshot.keys()) {
    if (!newSigs.has(ref)) removed.push(ref);
  }

  lastSnapshot = newSigs;

  return {
    added,
    removed,
    changed,
    unchanged_count: unchanged,
    total: items.length,
  };
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

  // Build a compact map of interactive elements with refs, so the agent
  // can act in ONE round-trip. Working on the live document — we need
  // real elements that resolve back via refMap. Also records the state
  // into lastSnapshot so the next page_after diffs against this.
  const interactiveSet = interactiveSnapshot();

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
    // Integer ref — what the LLM uses for tool calls. CSS selector is
    // intentionally NOT included in the LLM-facing payload (would defeat
    // the token savings); it's cached internally in refMap for resolution.
    // getOrAssignRef reuses existing refs across snapshots so element
    // identity is preserved (lets us emit minimal diffs in page_after).
    ref: getOrAssignRef(el as HTMLElement),
    tag,
  };
  if (ownText) out.text = ownText.slice(0, 80);
  const aria = el.getAttribute("aria-label");
  if (aria) out.aria = aria.slice(0, 80);
  for (const attr of ["data-action", "data-product-id", "data-filter", "data-sort", "data-testid"]) {
    const v = el.getAttribute(attr);
    if (v) out[attr] = v.slice(0, 60);
  }
  // Input metadata: surface the validation hints the page already declares,
  // so the agent doesn't waste a turn typing garbage and getting silently
  // rejected. Pattern / minlength / maxlength / inputmode / required tell
  // the model what shape of value the field will actually accept.
  if (el instanceof HTMLInputElement) {
    if (el.placeholder) out.placeholder = el.placeholder.slice(0, 60);
    if (el.name) out.name = el.name;
    out.input_type = el.type;
    if (el.required) out.required = "true";
    const pattern = el.getAttribute("pattern");
    if (pattern) out.pattern = pattern.slice(0, 80);
    const minlength = el.getAttribute("minlength");
    if (minlength) out.minlength = minlength;
    const maxlength = el.getAttribute("maxlength");
    if (maxlength) out.maxlength = maxlength;
    const inputmode = el.getAttribute("inputmode");
    if (inputmode) out.inputmode = inputmode;
    if (el.type === "number" || el.type === "range") {
      if (el.min) out.min = el.min;
      if (el.max) out.max = el.max;
      if (el.step) out.step = el.step;
    }
    if (el.type === "file" && el.accept) out.accept = el.accept.slice(0, 80);
    if (el.disabled) out.disabled = "true";
    if (el.checked && (el.type === "checkbox" || el.type === "radio")) {
      out.checked = "true";
    }
  } else if (el instanceof HTMLTextAreaElement) {
    if (el.placeholder) out.placeholder = el.placeholder.slice(0, 60);
    if (el.name) out.name = el.name;
    if (el.required) out.required = "true";
    const maxlength = el.getAttribute("maxlength");
    if (maxlength) out.maxlength = maxlength;
    if (el.disabled) out.disabled = "true";
  } else if (el instanceof HTMLSelectElement) {
    if (el.name) out.name = el.name;
    if (el.disabled) out.disabled = "true";
    if (el.required) out.required = "true";
    const options = Array.from(el.options);
    out.options_count = String(options.length);
    // Inline the first 4 option labels so the agent can speak them aloud
    // without an extra read_page round-trip.
    const preview = options
      .slice(0, 4)
      .map((o) => o.textContent?.trim().slice(0, 40) ?? "")
      .filter(Boolean)
      .join(" | ");
    if (preview) out.options_preview = preview;
    if (el.selectedIndex >= 0 && el.options[el.selectedIndex]) {
      const sel = el.options[el.selectedIndex].textContent?.trim() ?? "";
      if (sel) out.selected = sel.slice(0, 40);
    }
  } else if (el instanceof HTMLButtonElement) {
    if (el.disabled) out.disabled = "true";
  } else if (el instanceof HTMLAnchorElement) {
    if (el.href) out.href = el.href.slice(0, 120);
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
