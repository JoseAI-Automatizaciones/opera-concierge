# apps/api — (Reserved) Standalone API

> Read root `../../CLAUDE.md` first.

## Purpose

**Currently empty / reserved.** In v1, all API routes live inside `apps/dashboard` (Next.js API routes co-located with the dashboard UI). This folder exists for the case where we need to split the API into its own deploy (e.g. dedicated edge runtime, separate scaling, different region).

## When to populate this folder

- Latency-critical endpoints need to run on a different runtime than the dashboard.
- The API needs its own custom domain (e.g. `api.opera-concierge.com`).
- We want to deploy the API to a non-Vercel provider.

Until any of the above is true: **do not move code here.** Keep the API inside `apps/dashboard/app/api/*`.

## Status

🟦 Empty placeholder. Do not scaffold without a real reason.
