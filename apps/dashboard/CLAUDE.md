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

✅ Scaffolded + first vertical slice landed (Next.js 16.2.6 + React 19 + Tailwind 4).

Live routes:
- `/` — marketing/dashboard landing
- `/widgets` — list + create form (Server Action)
- `/api/widgets` (GET list / POST create) — same-origin mgmt API
- `/api/widget/config` (GET) — public, origin-allowlist gated
- `/api/realtime/session` (POST) — mints OpenAI Realtime ephemeral token

Realtime upstream:
- Endpoint: `POST https://api.openai.com/v1/realtime/client_secrets`
- Body shape used: `{ session: { type: "realtime", model, instructions, audio: { output: { voice } } } }`
- ⚠ Per OpenAI docs, clients CAN override `instructions`/`model`/`voice` during the WebRTC handshake — treat mint-time config as defaults, not policy.

Server Actions:
- Same-origin only by default (Next 16 checks Origin vs Host). Do NOT add `serverActions.allowedOrigins` to `next.config.ts` unless we have a specific need.

Auth (live):
- Supabase Auth magic-link via `lib/auth/session.ts` + `middleware.ts`.
- `ALLOWED_EMAILS` env (comma-separated) gates which addresses can sign in. Empty = fail closed.
- Middleware checks `auth.getUser()` session existence on `/widgets/*` and `/api/widgets/*`; page/API layer re-checks allowlist via `requireUser()` / `getApiUser()`.
- `/auth/confirm` verifies OTP, re-checks allowlist, signs out + redirects to `/login?e=not_allowed` on mismatch.
- `/auth/signout` is POST-only with Origin-vs-Host same-origin check.
- All `next` redirect params sanitized via `safeInternalPath()` — open redirects via `//evil.com`, `/\evil`, `/javascript:...` etc. are rejected.

Next steps (in order):
1. Rate limiting on `/api/realtime/session` and `/api/widget/config` per widget_id + IP.
2. Edit-widget page (`/widgets/[id]`) for system prompt, tools, advanced config.
3. Tools registry UI — operator can register custom API tools that the agent can call.
