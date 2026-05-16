# Opera Concierge — Project Context

> Read this file FIRST. Then read the `CLAUDE.md` of whichever subfolder you're working in.

## What this is

Opera Concierge is a **premium AI voice & text agent that operates websites autonomously**. Visitors of any web (e-commerce, SaaS, docs) can talk or type to the agent and it performs real actions — search, filter, add to cart, navigate, fill forms, answer from docs — using OpenAI Realtime API for voice and tool calling for actions.

It is a **submarca de Opera AI** (see `../identidad_visual_de_opera_ai.md` in the parent folder for visual identity).

## The product surface

Two pieces the user interacts with:

1. **Widget** — embeddable `<script>` snippet (or npm package) the customer drops into their website. Vanilla JS / Preact, ~15kb gzip. Captures voice + text, renders UI overlay, executes DOM actions, talks to backend.
2. **Dashboard** — Next.js app where the operator (single user in v1) configures their widget: API keys, branding (color, logo, position, shape), tools, prompt, voice. Dashboard generates the embed snippet to copy-paste.

A third piece nobody sees directly:

3. **API / Backend** — Next.js API routes that orchestrate LLM + tools via Vercel AI SDK. Handles Realtime session brokering, tool execution, persistence.

## Architecture

```
Visitor ──voice/text──▶ Widget (browser)
                          │
                          ├──▶ DOM actions (universal fallback)
                          │
                          └──▶ API (Vercel AI SDK)
                                 │
                                 ├──▶ OpenAI Realtime (voice)
                                 ├──▶ Claude/GPT (tool LLM)
                                 ├──▶ Tools (DOM bridge, Shopify, custom)
                                 └──▶ Supabase (config, logs, sessions)
```

## Stack

| Layer | Tech |
|---|---|
| Monorepo | Turborepo + pnpm |
| Dashboard | Next.js 15 (App Router) + AI Elements |
| Widget | Vite + Preact (lightweight) |
| API | Next.js API routes inside `apps/dashboard` (single deploy) |
| LLM orchestration | Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`) |
| Voice | OpenAI Realtime API (`gpt-realtime`) |
| Storage | Supabase (Postgres + Auth + Storage) |
| Hosting | Vercel (one-click deploy from README) |
| CLIs available | `gh`, `vercel`, `supabase` |

## Folder structure

```
opera-concierge/
├── apps/
│   ├── dashboard/    ← Next.js dashboard + API routes (the main deploy)
│   ├── widget/       ← Vite-built embeddable script
│   └── api/          ← (optional) standalone API if we split later
├── packages/
│   ├── core/         ← shared types, contracts, prompt templates
│   ├── voice/        ← OpenAI Realtime client wrapper
│   └── tools/        ← reusable tool definitions (DOM, Shopify, custom)
├── CLAUDE.md         ← you are here
├── TROUBLESHOOTING.md ← READ BEFORE IMPLEMENTING (see below)
└── README.md         ← user-facing, includes Deploy to Vercel button
```

Every subfolder has its **own `CLAUDE.md`** with local context. Always read it before editing inside that folder.

## Operating rules for agents working in this repo

1. **Read `TROUBLESHOOTING.md` before implementing.** It is an append-only log of every non-trivial bug that's been hit. If you're about to do something that overlaps with a logged error, verify the fix is in place. After fixing a new non-trivial bug, append to it using the exact template documented in that file (date + symptom + root cause + fix + prevention).
2. **CLAUDE.md is hierarchical.** Root first, then the subfolder's. Don't duplicate context between them — root covers cross-cutting concerns, sub covers local detail.
3. **Surgical changes only.** Don't refactor adjacent code unless asked.
4. **Risky surfaces** (auth, billing, secrets, deploy, `.env*`) require a Codex review before ending the task.
5. **Single-user v1.** Don't add multi-tenant scaffolding (auth orgs, RLS for user separation) unless the user asks. Keep it simple.
6. **No secrets in committed files.** `.env.local` is gitignored. Use `.env.example` as the documented surface.
7. **Deploy target is Vercel** — keep everything compatible with serverless functions (no long-running server processes, no filesystem state).

## ⚠ Before going public (must-do checklist)

Before flipping the repo to public OR deploying anywhere reachable from the internet:

1. ✅ **Auth on `/api/widgets*`, `/widgets`, Server Actions.** Done — Supabase Auth magic link + `ALLOWED_EMAILS` allowlist. Middleware refreshes session, every protected page/API re-checks allowlist. `/auth/signout` has same-origin check.
2. ✅ **Rate limiting on `/api/realtime/session`** (Layer 1). Done — per-widget configurable caps (sessions/minute, sessions/day, max session seconds) enforced atomically via `consume_quota` Postgres function. Bucket is `ip:<addr>` for v1; Layer 2 will switch to operator-asserted user identity when present.
3. ✅ **Realtime token policy boundary (best effort).** Done — `expires_after: 120s` shortens the window for token reuse after theft, `max_output_tokens` cap sent at mint time bounds well-behaved-client cost.

   ⚠ **Threat model truth:** once a Realtime session is live in the browser, the client can `session.update` to override `instructions`, `voice`, `model`, and tools. The mint-time config is a DEFAULT, not a hard boundary. The real defenses are:
   - **Origin allowlist** on `/api/realtime/session` — attacker must control the operator's domain to mint at all (server-side, unforgeable).
   - **Per-widget mint quotas** (Layer 1) — bounds the rate at which billable sessions can even start.
   - **Operator's OpenAI account spending cap** — MUST be set by the operator in their OpenAI dashboard. This is the final, externally-configured brake that nothing in this codebase can replace.

   The dashboard form surfaces this caveat to operators.

4. **Set `ALLOWED_EMAILS`** in the deploy environment. Empty/undefined fails closed (no one can sign in), but worth verifying after deploy.
5. **Set OpenAI account spending cap** in the operator's OpenAI dashboard. This is non-negotiable for production; nothing in this codebase substitutes for it.
6. **(Future)** Rate limiting on `/api/widget/config` (read-only, lower impact but worth adding). Layer 2 (operator-asserted visitor identity). Layer 3 (per-tool-call quotas).

These are tracked here intentionally; do not lose them.

## Quick start

```bash
pnpm install           # installs all workspace deps
pnpm dev               # turbo runs dashboard + widget in parallel
```

The dashboard runs on http://localhost:3000 and the widget dev server on its own port.

## External resources

- Vercel AI SDK docs: https://sdk.vercel.ai
- OpenAI Realtime API: https://platform.openai.com/docs/guides/realtime
- Supabase docs: https://supabase.com/docs

## Brand

- Name: **Opera Concierge** (submarca de Opera AI)
- Identity: muted mustard gold `#B08A3E`, graphite `#0E1117`, premium cinematic minimalism
- Assets: `apps/dashboard/public/logo.png`, `apps/dashboard/public/favicon.png`
