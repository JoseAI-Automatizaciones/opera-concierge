# packages/voice — OpenAI Realtime Client

> Read root `../../CLAUDE.md` first.

## Purpose

Thin wrapper around the OpenAI Realtime API (`gpt-realtime`). Used by the widget for browser-side voice I/O.

## Responsibilities

- Establish a WebRTC (or WebSocket fallback) connection to OpenAI Realtime using an ephemeral session token minted by the API.
- Capture mic audio and stream upstream.
- Play back assistant audio.
- Expose lifecycle events: `session.created`, `input.speech_started`, `response.text.delta`, `response.audio.delta`, `tool_call.requested`, `error`.
- Surface tool-call requests so the widget can execute DOM tools and return results.

## Constraints

- The ephemeral token MUST come from the server (`/api/realtime/session`). Never put `OPENAI_API_KEY` here.
- Must handle reconnection on network blips.
- Must respect host page's audio context (don't autoplay loudly; require user gesture first).

## API surface (planned)

```ts
const session = await createRealtimeSession({
  fetchToken: () => fetch("/api/realtime/session").then(r => r.json()),
  voice: "verse",
  instructions: "...",
  tools: [...]
});

session.on("tool_call.requested", async (call) => {
  const result = await runTool(call);
  session.sendToolResult(call.id, result);
});

session.start();
```

## Status

🚧 Not yet scaffolded.
