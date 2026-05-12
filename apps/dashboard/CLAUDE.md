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

- Next.js 15 (App Router) with React Server Components.
- Vercel AI SDK + AI Elements for chat UI.
- `@supabase/ssr` for server-side Supabase.
- Tailwind CSS — Opera AI design tokens defined in `tailwind.config.ts`.

## Conventions

- All routes that mutate state are POST/PATCH/DELETE, never GET.
- The widget origin is untrusted — `/api/widget/config` returns only public-safe fields. Secret keys never leave the server.
- Realtime tokens are short-lived (ephemeral keys from OpenAI). Never expose `OPENAI_API_KEY` to the client.

## Assets

- `public/logo.png` — full horizontal logo
- `public/favicon.png` — square favicon (used as `apps/dashboard/app/favicon.png`)

## Status

🚧 Not yet scaffolded. Next step: `pnpm create next-app@latest .` inside this folder, then wire AI SDK, Supabase, Tailwind.
