import { useEffect, useState, useRef } from "preact/hooks";
import type {
  PublicWidgetConfig,
  TranscriptEntry,
  WidgetStatus,
} from "./types";
import { fetchWidgetConfig, mintRealtimeSession } from "./lib/api";
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

  const handleRef = useRef<RealtimeHandle | null>(null);
  const aliveRef = useRef(true);

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
    } catch (err) {
      if (!aliveRef.current) return;
      if (err instanceof MicrophoneDeniedError) {
        setError(err.message);
      } else {
        setError((err as Error).message);
      }
      setStatus("error");
    }
  };

  const stop = () => {
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
