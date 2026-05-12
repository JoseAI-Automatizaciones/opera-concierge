import type { RealtimeSession, TranscriptEntry } from "../types";
import { dispatchTool, toolDefinitions } from "./tools/registry";

/**
 * OpenAI Realtime WebRTC client.
 *
 * Flow:
 * 1. Caller mints an ephemeral token via the dashboard's /api/realtime/session.
 * 2. We open an RTCPeerConnection, attach the user's microphone, set up a
 *    DataChannel for control events, and create an SDP offer.
 * 3. POST the offer to https://api.openai.com/v1/realtime?model=<model>
 *    using the ephemeral token as Bearer auth. The response body is the
 *    SDP answer.
 * 4. Once the DataChannel is open, send `session.update` to register the
 *    widget's DOM tool definitions so the agent can call them.
 * 5. Wire up remote audio playback when the assistant track arrives.
 *
 * Resource discipline: if ANY step after mic acquisition fails, we tear
 * down the mic, PeerConnection, DataChannel, and audio element before
 * rethrowing — never leave the microphone live after a failed connect.
 *
 * Reference:
 *   https://platform.openai.com/docs/guides/realtime#connect-via-webrtc
 */

const REALTIME_BASE = "https://api.openai.com/v1/realtime";

export type RealtimeEvents = {
  onStatus: (s: "connecting" | "live" | "ended" | "error") => void;
  onTranscript: (entry: TranscriptEntry) => void;
  onToolCall: (call: { name: string; args: unknown; ok: boolean }) => void;
  onError: (err: Error) => void;
};

export type RealtimeHandle = {
  stop: () => void;
};

export class MicrophoneDeniedError extends Error {
  constructor() {
    super(
      "Microphone access denied. Opera Concierge needs the microphone for voice."
    );
    this.name = "MicrophoneDeniedError";
  }
}

export async function connectRealtime(
  session: RealtimeSession,
  events: RealtimeEvents
): Promise<RealtimeHandle> {
  events.onStatus("connecting");

  const ephemeralKey = session.client_secret?.value;
  if (!ephemeralKey) {
    throw new Error("Realtime session missing client_secret.value.");
  }

  const model = session.session?.model ?? "gpt-realtime";

  // Step 1: mic.
  let mic: MediaStream;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    events.onStatus("error");
    throw new MicrophoneDeniedError();
  }

  // Step 2: PC + tracks + data channel. Failure → tear down mic + PC.
  const pc = new RTCPeerConnection();
  const remoteAudio = document.createElement("audio");
  remoteAudio.autoplay = true;

  let dc: RTCDataChannel | null = null;
  let stopped = false;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    mic.getTracks().forEach((t) => t.stop());
    if (dc && dc.readyState === "open") dc.close();
    pc.close();
    remoteAudio.srcObject = null;
  };

  const sendEvent = (event: Record<string, unknown>) => {
    if (!dc || dc.readyState !== "open") return;
    dc.send(JSON.stringify(event));
  };

  try {
    pc.ontrack = (event) => {
      if (event.streams[0]) {
        remoteAudio.srcObject = event.streams[0];
      }
    };
    mic.getTracks().forEach((track) => pc.addTrack(track, mic));

    dc = pc.createDataChannel("oai-events");
    const transcripts = new Map<string, TranscriptEntry>();

    dc.addEventListener("open", () => {
      // Register DOM tools so the agent can call them.
      sendEvent({
        type: "session.update",
        session: { tools: toolDefinitions, tool_choice: "auto" },
      });
    });

    dc.addEventListener("message", (evt) => {
      let msg: unknown;
      try {
        msg = JSON.parse(evt.data as string);
      } catch {
        return;
      }
      handleEvent(msg, transcripts, events, sendEvent);
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResponse = await fetch(
      `${REALTIME_BASE}?model=${encodeURIComponent(model)}`,
      {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
      }
    );

    if (!sdpResponse.ok) {
      throw new Error(
        `Realtime SDP exchange failed: ${sdpResponse.status} ${sdpResponse.statusText}`
      );
    }

    const answerSdp = await sdpResponse.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  } catch (err) {
    cleanup();
    events.onStatus("error");
    throw err;
  }

  pc.addEventListener("connectionstatechange", () => {
    if (pc.connectionState === "connected") events.onStatus("live");
    if (pc.connectionState === "failed") {
      cleanup();
      events.onStatus("error");
    }
    if (
      pc.connectionState === "closed" ||
      pc.connectionState === "disconnected"
    ) {
      events.onStatus("ended");
    }
  });

  return {
    stop: () => {
      cleanup();
      events.onStatus("ended");
    },
  };
}

/** Buffer of in-flight function call argument streams keyed by call_id. */
const callArgsBuffers = new WeakMap<
  Map<string, TranscriptEntry>,
  Map<string, string>
>();

function getCallBuffer(transcripts: Map<string, TranscriptEntry>) {
  let buf = callArgsBuffers.get(transcripts);
  if (!buf) {
    buf = new Map();
    callArgsBuffers.set(transcripts, buf);
  }
  return buf;
}

function handleEvent(
  msg: unknown,
  transcripts: Map<string, TranscriptEntry>,
  events: RealtimeEvents,
  sendEvent: (event: Record<string, unknown>) => void
) {
  if (typeof msg !== "object" || msg === null) return;
  const m = msg as Record<string, unknown>;

  switch (m.type) {
    case "conversation.item.input_audio_transcription.completed": {
      const id = String(m.item_id ?? cryptoRandomId());
      const text = String(m.transcript ?? "");
      const entry: TranscriptEntry = { id, role: "user", text };
      transcripts.set(id, entry);
      events.onTranscript(entry);
      break;
    }
    case "response.audio_transcript.delta": {
      const id = String(m.response_id ?? "current");
      const prev = transcripts.get(id);
      const text = (prev?.text ?? "") + String(m.delta ?? "");
      const entry: TranscriptEntry = { id, role: "assistant", text };
      transcripts.set(id, entry);
      events.onTranscript(entry);
      break;
    }
    case "response.audio_transcript.done": {
      const id = String(m.response_id ?? "current");
      const text = String(m.transcript ?? transcripts.get(id)?.text ?? "");
      const entry: TranscriptEntry = { id, role: "assistant", text };
      transcripts.set(id, entry);
      events.onTranscript(entry);
      break;
    }

    // Streaming function call arguments — buffer until .done.
    case "response.function_call_arguments.delta": {
      const callId = String(m.call_id ?? "");
      if (!callId) return;
      const buf = getCallBuffer(transcripts);
      buf.set(callId, (buf.get(callId) ?? "") + String(m.delta ?? ""));
      break;
    }

    // Final tool call: dispatch, send output, request next assistant turn.
    case "response.function_call_arguments.done": {
      const callId = String(m.call_id ?? "");
      const name = String(m.name ?? "");
      const buf = getCallBuffer(transcripts);
      const argsRaw = String(m.arguments ?? buf.get(callId) ?? "");
      buf.delete(callId);

      // Fail closed on malformed JSON: do NOT dispatch with default args,
      // because some tools (read_page) have all-optional schemas and would
      // execute with full default capability.
      let parsed: unknown;
      try {
        parsed = JSON.parse(argsRaw);
      } catch {
        parsed = null;
      }

      let result: unknown;
      let ok = false;
      if (parsed === null || typeof parsed !== "object") {
        result = { ok: false, error: "invalid_tool_arguments" };
      } else {
        try {
          result = dispatchTool(name, parsed);
          if (
            result &&
            typeof result === "object" &&
            "ok" in (result as Record<string, unknown>)
          ) {
            ok = Boolean((result as { ok?: unknown }).ok);
          } else {
            ok = true;
          }
        } catch (err) {
          result = { ok: false, error: (err as Error).message };
        }
      }

      events.onToolCall({ name, args: parsed ?? {}, ok });

      sendEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(result),
        },
      });
      sendEvent({ type: "response.create" });
      break;
    }

    case "error": {
      events.onError(
        new Error(String((m as { message?: string }).message ?? "Realtime error"))
      );
      events.onStatus("error");
      break;
    }
    default:
      break;
  }
}

function cryptoRandomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
  );
}
