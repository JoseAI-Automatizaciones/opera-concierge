# Troubleshooting Log

> **Append-only.** Every non-trivial error encountered in this project goes here. Future agents (and humans) read this BEFORE implementing to avoid repeating mistakes.

## How to use this file

**When you hit a bug worth remembering:**

1. Do NOT delete or edit older entries.
2. Add a new entry at the bottom in this format:

```
## [YYYY-MM-DD] Short title of the problem

**Symptom**
What was observed. Error message, unexpected behavior, etc.

**Root cause**
The actual underlying reason — not the surface symptom.

**Fix**
What was done. Reference specific files / lines / commits if possible.

**How to prevent it next time**
What to check or do differently in the future. This is the most valuable part.
```

**When starting work:**

- Scan the titles of entries below. If any sounds related to what you're about to do, read it fully.
- If the same error appears again, that means the prevention guidance failed — update it, don't just re-fix silently.

**What counts as worth logging:**

- Anything that took more than 15 minutes to diagnose.
- Anything where the surface symptom was misleading.
- Anything involving Supabase, Vercel deployment, env vars, CORS, voice/audio, or LLM tool calling.
- Any error you can imagine yourself or another agent making again.

**What does NOT belong here:**

- Typos.
- Trivial syntax errors.
- "I forgot to install X" (unless install order matters and isn't obvious).

---

## Entries

_(none yet — first errors will be logged here)_
