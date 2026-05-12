# apps/dashboard — Configuration UI + API

> Read root `../../CLAUDE.md` first. This file covers only what's specific to this app.

## Purpose

The Next.js application where the operator configures their widget. Also hosts the API routes that the embedded widget talks to (LLM orchestration, Realtime session brokering, tool execution).

In v1 this is the **single Vercel deploy**. The widget's `widget.js` file is also served from here (as a static asset built by `apps/widget`).

## Responsibilities

- Render configuration UI: branding, API keys, voice settings, tools, prompt.
- Generate the copy-paste snippet for the operator.
- Host API routes consumed by the widget:
  - `/api/realtime/session` — broker an ephemeral OpenAI Realtime session token.
  - `/api/chat` — text fallback via Vercel AI SDK.
  - `/api/tools/[name]` — server-side tool execution.
  - `/api/widget/config?id=...` — public config fetch for an embedded widget.
- Persist config to Supabase.

## CORS policy (all widget-facing routes)

All four routes above are called from an **untrusted origin** (the host site embedding the widget). They MUST:

- Validate `widget_id` exists in Supabase and the host origin matches the operator's allowlisted origins for that widget.
- Set `Access-Control-Allow-Origin` to the validated origin (never `*` on routes that mint tokens or run tools).
- Return only public-safe fields on `/api/widget/config`. Server secrets never reach the client.
- Rate-limit per `widget_id` (Realtime tokens are expensive).

## Stack

- Next.js 16 (App Router, Turbopack) with React Server Components — React 19.
- Tailwind CSS v4 (postcss-based, no `tailwind.config.ts` — config lives in `app/globals.css` via `@theme`).
- ESLint 9 (flat config in `eslint.config.mjs`).
- TypeScript with `@/*` import alias.
- Vercel AI SDK + AI Elements for chat UI (to be added).
- `@supabase/ssr` for server-side Supabase (to be added).

## Conventions

- All routes that mutate state are POST/PATCH/DELETE, never GET.
- The widget origin is untrusted — `/api/widget/config` returns only public-safe fields. Secret keys never leave the server.
- Realtime tokens are short-lived (ephemeral keys from OpenAI). Never expose `OPENAI_API_KEY` to the client.

## Assets

- `public/logo.png` — full horizontal logo
- `public/favicon.png` — square favicon (used as `apps/dashboard/app/favicon.png`)

## Status

✅ Scaffolded (Next.js 16.2.6 + React 19 + Tailwind 4 + ESLint 9 + Turbopack).

Next steps (in order):
1. Define Opera Concierge color tokens in `app/globals.css` (`@theme` block — gold `#B08A3E`, graphite `#0E1117`).
2. Replace the default Next.js landing page in `app/page.tsx` with a dashboard shell.
3. Install Supabase client: `pnpm add @supabase/supabase-js @supabase/ssr`.
4. Install AI SDK: `pnpm add ai @ai-sdk/openai @ai-sdk/anthropic`.
5. Build the first API route: `app/api/widget/config/route.ts` (GET widget config by id).
6. Build the first dashboard page: `app/page.tsx` with the widget setup wizard.
