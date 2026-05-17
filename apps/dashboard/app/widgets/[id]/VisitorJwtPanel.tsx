"use client";

import { useState, useTransition } from "react";
import { setVisitorJwtSecret } from "../actions";

export function VisitorJwtPanel({
  widgetId,
  hasSecret,
  appUrl,
}: {
  widgetId: string;
  hasSecret: boolean;
  appUrl: string;
}) {
  const [pending, startTransition] = useTransition();
  const [recentSecret, setRecentSecret] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(hasSecret);
  const [error, setError] = useState<string | null>(null);

  const run = (mode: "generate" | "rotate" | "disable") => {
    setError(null);
    startTransition(async () => {
      const result = await setVisitorJwtSecret(widgetId, mode);
      if (!result.ok) {
        setError(result.message ?? "Failed");
        return;
      }
      setEnabled(mode !== "disable");
      setRecentSecret(result.secret ?? null);
    });
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* ignore */
    }
  };

  return (
    <fieldset className="rounded-2xl border border-white/[0.06] p-5">
      <legend className="px-2 text-xs font-medium uppercase tracking-[0.18em] text-opera-gold">
        Visitor identity signing (Layer 2 signed)
      </legend>

      <p className="text-xs text-opera-muted/80">
        When enabled, the widget rejects raw <code>data-opera-user-id</code> and
        requires <code>data-opera-user-token</code> — an HS256 JWT your backend
        signs with this secret. Visitors can&apos;t forge their identity by
        editing the script tag.
      </p>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-sm">
          Status:{" "}
          <strong className={enabled ? "text-opera-gold" : "text-opera-muted"}>
            {enabled ? "Enabled" : "Disabled"}
          </strong>
        </span>
        <div className="flex flex-wrap gap-2">
          {enabled ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => run("rotate")}
                className="rounded-full border border-white/10 px-3 py-1 text-xs hover:bg-white/[0.05] disabled:opacity-50"
              >
                {pending ? "Working…" : "Rotate secret"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (confirm("Disable signed mode? Active integrations will break until you re-enable.")) {
                    run("disable");
                  }
                }}
                className="rounded-full border border-red-300/20 px-3 py-1 text-xs text-red-300/80 hover:bg-red-300/[0.05] disabled:opacity-50"
              >
                Disable
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => run("generate")}
              className="rounded-full bg-opera-gold px-4 py-1 text-xs font-medium text-opera-black hover:bg-opera-amber disabled:opacity-50"
            >
              {pending ? "Generating…" : "Enable signed mode"}
            </button>
          )}
        </div>
      </div>

      {error ? (
        <p className="mt-3 text-xs text-red-300">{error}</p>
      ) : null}

      {recentSecret ? (
        <div className="mt-4 space-y-2">
          <div className="rounded-xl border border-opera-gold/30 bg-opera-gold/[0.08] p-3 text-xs">
            <p className="font-medium text-opera-amber">
              Copy this secret now — it won&apos;t be shown again.
            </p>
            <p className="mt-1 text-opera-muted/80">
              Store it in your backend env vars (e.g.{" "}
              <code>OPERA_VISITOR_JWT_SECRET</code>). To rotate, click Rotate
              and update your backend.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="block grow overflow-x-auto break-all rounded-md bg-black/40 px-2 py-1 font-mono text-[11px] text-opera-amber">
                {recentSecret}
              </code>
              <button
                type="button"
                onClick={() => copy(recentSecret)}
                className="rounded-full border border-white/10 px-3 py-1 text-xs hover:bg-white/[0.05]"
              >
                Copy
              </button>
            </div>
          </div>

          <details className="rounded-xl border border-white/10 p-3 text-xs">
            <summary className="cursor-pointer text-opera-muted">
              Sample backend code (Node + jsonwebtoken)
            </summary>
            <pre className="mt-3 overflow-x-auto rounded-md bg-black/40 p-3 text-[11px] text-opera-amber">
{`// Backend (Node) — issue a token for the current visitor on each page load.
// npm install jsonwebtoken
import jwt from "jsonwebtoken";

const token = jwt.sign(
  { sub: user.id, exp: Math.floor(Date.now() / 1000) + 15 * 60 },
  process.env.OPERA_VISITOR_JWT_SECRET,
  { algorithm: "HS256" }
);

// Embed in the page:
res.send(\`
  <script
    src="${appUrl}/widget.js"
    data-opera-id="${widgetId}"
    data-opera-user-token="\${token}"
    defer
  ></script>
\`);`}
            </pre>
          </details>
        </div>
      ) : enabled ? (
        <p className="mt-3 text-xs text-opera-muted/80">
          Secret is set on the server. Visit Rotate to mint a fresh value
          (shown once); the old secret stops working immediately.
        </p>
      ) : null}
    </fieldset>
  );
}
