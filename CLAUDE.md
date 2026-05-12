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
| Storage | Supabase (project ref: `srrqaipnxtjhbapfgwwa`) |
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

## Quick start

⚠️ **Apps are not yet scaffolded.** The repo currently contains the monorepo skeleton only. Before `pnpm dev` will do anything useful, you must scaffold the apps:

```bash
pnpm install                         # installs turbo + typescript only (no app deps yet)

# Then scaffold each app (one-time):
cd apps/dashboard && pnpm create next-app@latest . --typescript --tailwind --app
cd ../widget     && pnpm create vite@latest . --template preact-ts

# After scaffolding:
pnpm dev               # turbo runs dashboard + widget in parallel
```

Until scaffolded, `pnpm dev` will print the placeholder message in each `apps/*/package.json`.

## External resources

- Supabase project dashboard: https://supabase.com/dashboard/project/srrqaipnxtjhbapfgwwa
- GitHub repo: https://github.com/JoseAI-Automatizaciones/opera-concierge
- Vercel AI SDK docs: https://sdk.vercel.ai
- OpenAI Realtime API: https://platform.openai.com/docs/guides/realtime

## Brand

- Name: **Opera Concierge** (submarca de Opera AI)
- Identity: muted mustard gold `#B08A3E`, graphite `#0E1117`, premium cinematic minimalism
- Assets: `apps/dashboard/public/logo.png`, `apps/dashboard/public/favicon.png`
