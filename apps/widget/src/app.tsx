import { useEffect, useState, useRef } from "preact/hooks";
import type {
  PublicWidgetConfig,
  TranscriptEntry,
  WidgetStatus,
} from "./types";
import {
  fetchWidgetConfig,
  mintRealtimeSession,
  RateLimitedError,
} from "./lib/api";
import {
  connectRealtime,
  MicrophoneDeniedError,
  type RealtimeHandle,
} from "./lib/realtime";

type Props = {
  widgetId: string;
  apiOrigin: string;
  /** The custom-element host owning the shadow root this app is mounted in. */
  shadowHost: HTMLElement;
};

export function App({ widgetId, apiOrigin, shadowHost }: Props) {
  const [status, setStatus] = useState<WidgetStatus>("loading-config");
  const [config, setConfig] = useState<PublicWidgetConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [transcripts, setTranscripts] = useState<Map<string, TranscriptEntry>>(
    () => new Map()
  );
  const [toolActivity, setToolActivity] = useState<
    Array<{ id: string; name: string; ok: boolean }>
  >([]);

  const handleRef = useRef<RealtimeHandle | null>(null);
  const aliveRef = useRef(true);
  const sessionTimerRef = useRef<number | null>(null);

  const clearSessionTimer = () => {
    if (sessionTimerRef.current !== null) {
      window.clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
  };

  // Load public config. Failure leaves the widget invisible.
  useEffect(() => {
    let cancelled = false;
    fetchWidgetConfig(apiOrigin, widgetId)
      .then((cfg) => {
        if (cancelled) return;
        setConfig(cfg);
        setStatus("ready");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setStatus("config-error");
      });
    return () => {
      cancelled = true;
    };
  }, [apiOrigin, widgetId]);

  // Apply primary color as a CSS custom property on our own shadow host
  // (not via global querySelector, which could race with other instances).
  useEffect(() => {
    if (!config) return;
    shadowHost.style.setProperty("--opera-gold", config.primary_color);
  }, [config, shadowHost]);

  // Unmount cleanup: tear down any live session AND cancel any in-flight start.
  useEffect(() => {
    return () => {
      aliveRef.current = false;
      clearSessionTimer();
      handleRef.current?.stop();
      handleRef.current = null;
    };
  }, []);

  const start = async () => {
    if (status === "connecting" || status === "live") return;
    setError(null);
    setStatus("connecting");
    try {
      const session = await mintRealtimeSession(apiOrigin, widgetId);
      if (!aliveRef.current) return;

      const handle = await connectRealtime(session, {
        onStatus: (s) => {
          if (aliveRef.current) setStatus(s);
        },
        onTranscript: (entry) => {
          if (!aliveRef.current) return;
          setTranscripts((prev) => {
            const next = new Map(prev);
            next.set(entry.id, entry);
            return next;
          });
        },
        onToolCall: (call) => {
          if (!aliveRef.current) return;
          setToolActivity((prev) =>
            [
              ...prev,
              {
                id: `${call.name}-${Date.now()}-${Math.random()}`,
                name: call.name,
                ok: call.ok,
              },
            ].slice(-5)
          );
        },
        onError: (err) => {
          if (aliveRef.current) setError(err.message);
        },
      });

      // If we unmounted while connectRealtime was resolving, tear it down
      // immediately so no orphaned mic/PC outlives the component.
      if (!aliveRef.current) {
        handle.stop();
        return;
      }
      handleRef.current = handle;

      // Wall-clock session cap: auto-stop at max_session_seconds. Server-side
      // quota check protects the bill; this protects the OpenAI-side runtime
      // bill for sessions a user leaves open accidentally.
      clearSessionTimer();
      if (config?.max_session_seconds && config.max_session_seconds > 0) {
        sessionTimerRef.current = window.setTimeout(() => {
          if (!aliveRef.current) return;
          handleRef.current?.stop();
          handleRef.current = null;
          setError("Session time limit reached.");
        }, config.max_session_seconds * 1000);
      }
    } catch (err) {
      if (!aliveRef.current) return;
      if (err instanceof MicrophoneDeniedError || err instanceof RateLimitedError) {
        setError(err.message);
      } else {
        setError((err as Error).message);
      }
      setStatus("error");
    }
  };

  const stop = () => {
    clearSessionTimer();
    handleRef.current?.stop();
    handleRef.current = null;
  };

  if (status === "config-error" || !config) return null;

  const sortedTranscripts = Array.from(transcripts.values());

  // stopPropagation on click handlers so host page listeners on document/body
  // don't observe widget interactions as composed click events.
  const swallow = (e: Event) => e.stopPropagation();

  return (
    <div class="root" data-position={config.position} onClick={swallow}>
      <div class="stack">
        {open ? (
          <div class="panel">
            <header class="panel-header">
              <div>
                <div class="panel-title">{config.name}</div>
                <div class="panel-status">{statusLabel(status, error)}</div>
              </div>
              <button
                class="panel-close"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            <div class="transcript">
              {sortedTranscripts.map((entry) => (
                <div class="entry" key={entry.id} data-role={entry.role}>
                  <span class="who">
                    {entry.role === "user" ? "You" : config.name}
                  </span>
                  <span>{entry.text}</span>
                </div>
              ))}
              {toolActivity.length > 0 ? (
                <div class="tool-activity">
                  {toolActivity.map((t) => (
                    <span class="tool-chip" key={t.id} data-ok={String(t.ok)}>
                      {t.ok ? "✓" : "⚠"} {humanizeTool(t.name)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <footer class="footer">
              <span>
                {status === "live"
                  ? "Listening — speak naturally"
                  : status === "connecting"
                    ? "Connecting…"
                    : status === "error"
                      ? error ?? "Something went wrong"
                      : "Tap start to talk"}
              </span>
              {status === "live" || status === "connecting" ? (
                <button class="end" onClick={stop} type="button">
                  End
                </button>
              ) : (
                <button class="end" onClick={start} type="button">
                  Start
                </button>
              )}
            </footer>
          </div>
        ) : null}

        <button
          class="button"
          type="button"
          data-status={status}
          onClick={() => {
            setOpen((v) => !v);
            if (!open && status === "ready") start();
          }}
        >
          <span class="dot" />
          <span>{open ? "Hide" : "Talk to " + config.name}</span>
        </button>
      </div>
    </div>
  );
}

function humanizeTool(name: string): string {
  switch (name) {
    case "find_elements":
      return "Looked at the page";
    case "click_element":
      return "Clicked";
    case "fill_field":
      return "Filled a field";
    case "scroll_to_element":
      return "Scrolled";
    case "read_page":
      return "Read the page";
    case "navigate_to":
      return "Navigated";
    default:
      return name;
  }
}

function statusLabel(status: WidgetStatus, error: string | null): string {
  switch (status) {
    case "live":
      return "Live · listening";
    case "connecting":
      return "Connecting";
    case "ended":
      return "Session ended";
    case "error":
      return error ? `Error · ${error}` : "Error";
    case "ready":
      return "Ready";
    default:
      return "Loading";
  }
}
