"use client";

import { useState, useTransition } from "react";
import { setCustomTools } from "../actions";
/** Subset of CustomToolDef the panel works with — auth_header is either
 *  a real string the operator just typed or the "__REDACTED__" sentinel
 *  the server replaced before serialization. */
type PanelTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  endpoint: string;
  method?: string;
  auth_header?: string;
  timeout_ms?: number;
};

export function CustomToolsPanel({
  widgetId,
  initialTools,
}: {
  widgetId: string;
  initialTools: PanelTool[];
}) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(() =>
    JSON.stringify(initialTools, null, 2)
  );
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await setCustomTools(widgetId, draft);
      setMessage({
        ok: result.ok,
        text: result.ok ? "Saved." : result.message ?? "Failed.",
      });
    });
  };

  return (
    <fieldset className="rounded-2xl border border-white/[0.06] p-5">
      <legend className="px-2 text-xs font-medium uppercase tracking-[0.18em] text-opera-gold">
        Custom HTTP tools
      </legend>

      <p className="text-xs text-opera-muted/80">
        Declare HTTP endpoints the agent can call. The backend proxies each
        call with your <code>auth_header</code> attached server-side
        (visitors never see it). Max 32 tools per widget.
      </p>

      <div className="mt-3 rounded-xl border border-red-300/20 bg-red-300/[0.04] p-3 text-xs text-red-200/90">
        <strong className="text-red-200">⚠ Treat tool args as untrusted.</strong>{" "}
        A visitor with DevTools can craft any <code>tool_name</code> + args
        and replay them through our proxy (rate-limited but still possible).
        Always validate args in your backend — enforce auth, scope queries
        to the visitor identity in <code>X-Opera-Visitor</code> (only
        present in signed JWT mode), and refuse unsafe operations.
      </div>

      <details className="mt-3 rounded-xl border border-white/10 p-3 text-xs">
        <summary className="cursor-pointer text-opera-muted">
          Schema (click to expand)
        </summary>
        <pre className="mt-3 overflow-x-auto rounded-md bg-black/40 p-3 text-[11px] text-opera-amber">
{`[
  {
    "name": "lookup_order",              // snake_case, 1-40 chars
    "description": "Look up an order by ID and return its status.",
    "parameters": {                       // JSON Schema sent to the model
      "type": "object",
      "properties": {
        "order_id": { "type": "string" }
      },
      "required": ["order_id"]
    },
    "endpoint": "https://api.your-shop.com/orders/lookup",  // https only
    "method": "POST",
    "auth_header": "Bearer sk_live_...",  // optional, ≤200 chars
    "timeout_ms": 5000                    // optional, 100-30000
  }
]`}
        </pre>
        <p className="mt-2 text-opera-muted/80">
          Server attaches headers <code>X-Opera-Widget-Id</code> and (when a
          visitor identity is available) <code>X-Opera-Visitor</code>. Your
          endpoint receives the model&apos;s JSON args as the POST body.
          Responses larger than 8&nbsp;KB are truncated.
        </p>
      </details>

      <textarea
        value={draft}
        onChange={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
        rows={14}
        className="opera-input mt-4 font-mono text-xs"
        spellCheck={false}
        placeholder='[]'
      />

      <div className="mt-3 flex items-center justify-between gap-4">
        <p
          className={`text-xs ${
            message?.ok
              ? "text-opera-gold"
              : message
                ? "text-red-300"
                : "text-opera-muted"
          }`}
        >
          {message?.text ?? "Paste an empty array [] to remove all tools."}
        </p>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-full bg-opera-gold px-4 py-1 text-xs font-medium text-opera-black hover:bg-opera-amber disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save tools"}
        </button>
      </div>
    </fieldset>
  );
}
