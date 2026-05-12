# packages/core — Shared Types & Contracts

> Read root `../../CLAUDE.md` first.

## Purpose

Cross-package shared TypeScript types and contracts. Anything used by both `widget` and `dashboard` (or any other future app) lives here.

## What goes here

- **Types** — `WidgetConfig`, `ToolDefinition`, `RealtimeSessionToken`, `ConversationEvent`, etc.
- **Zod schemas** — input/output validation shared between client and server.
- **Constants** — protocol message names, version strings, default values.
- **Prompt templates** — base system prompts that the LLM uses.

## What does NOT go here

- Anything React/Preact specific → goes to the consuming app.
- Anything Next.js specific → goes to `apps/dashboard`.
- Anything OpenAI-client specific → goes to `packages/voice`.
- Anything tool implementation → goes to `packages/tools`.

## Conventions

- ESM only (`"type": "module"`).
- No runtime deps if possible. Zod is the one allowed runtime dep.
- Export everything from `src/index.ts`.

## Status

🚧 Not yet scaffolded.
