"use client";

import { useState, useTransition } from "react";
import type { WidgetRow } from "@/lib/supabase/types";
import { deleteWidget } from "./actions";

export function WidgetRowCard({
  widget,
  appUrl,
}: {
  widget: WidgetRow;
  appUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const snippet = `<script src="${appUrl}/widget.js" data-opera-id="${widget.id}" defer></script>`;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const onDelete = () => {
    if (!confirm(`Delete widget "${widget.name}"? This can't be undone.`)) {
      return;
    }
    startTransition(async () => {
      await deleteWidget(widget.id);
    });
  };

  return (
    <article className="opera-card flex flex-col gap-4 p-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-medium text-opera-white">
            {widget.name}
          </h3>
          <p className="mt-1 font-mono text-xs text-opera-muted">{widget.id}</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span
            className="inline-flex h-6 items-center rounded-full px-2 font-mono uppercase tracking-wider"
            style={{
              background: widget.primary_color + "22",
              color: widget.primary_color,
              border: `1px solid ${widget.primary_color}55`,
            }}
          >
            {widget.primary_color}
          </span>
          <span className="rounded-full border border-white/10 px-2 py-0.5 text-opera-muted">
            {widget.position}
          </span>
          <span className="rounded-full border border-white/10 px-2 py-0.5 text-opera-muted">
            {widget.voice}
          </span>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-opera-amber">
          <code>{snippet}</code>
        </pre>
        <button
          type="button"
          onClick={onCopy}
          className="h-9 rounded-full border border-white/10 px-4 text-xs font-medium text-opera-white transition hover:border-white/20 hover:bg-white/[0.05]"
        >
          {copied ? "Copied ✓" : "Copy snippet"}
        </button>
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
        <p className="text-xs text-opera-muted">
          {widget.allowed_origins.length === 0
            ? "⚠ No allowed origins — widget will refuse to load anywhere"
            : `Allowed origins: ${widget.allowed_origins.join(", ")}`}
        </p>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="text-xs text-red-300/80 underline-offset-2 hover:underline disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Delete"}
        </button>
      </footer>
    </article>
  );
}
