# packages/tools — Tool Library

> Read root `../../CLAUDE.md` first.

## Purpose

Reusable tool definitions the LLM can call. Tools are the bridge between "LLM said do X" and "X actually happens on the page or in an API."

## Tool categories

### DOM tools (run client-side in the widget)

Universal fallback that works on any website without integration. Examples:
- `dom.query(selector)` — find elements.
- `dom.click(selector)` — click.
- `dom.fill(selector, value)` — fill an input (with safety denylist).
- `dom.scrollTo(selector)` — scroll to.
- `dom.readText(selector)` — extract visible text.
- `dom.navigate(url)` — same-origin navigation.

### API tools (run server-side in dashboard's API routes)

Faster, more reliable when the host site has an API. Examples (planned):
- `shopify.searchProducts({ q })`
- `shopify.addToCart({ variantId, qty })`
- `custom.fetch({ url, method, body })` — operator-defined HTTP tool.

### Knowledge tools (run server-side)

- `knowledge.search({ query })` — search the operator's uploaded docs (RAG).

## Contracts

Every tool exports:

```ts
{
  name: string;            // unique
  description: string;     // for the LLM
  parameters: ZodSchema;   // validated before invoke
  side: "client" | "server";
  invoke: (params, ctx) => Promise<result>;
}
```

## Safety rules

- Tools that fill inputs MUST check a denylist (password fields, credit card fields, anything with `autocomplete="cc-*"`).
- Tools that POST to APIs MUST require an explicit operator-configured allowlist of origins.
- Tools cannot navigate cross-origin without explicit configuration.

## Status

🚧 Not yet scaffolded.
