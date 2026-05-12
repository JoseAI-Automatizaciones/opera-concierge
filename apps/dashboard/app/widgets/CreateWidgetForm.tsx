"use client";

import { useActionState } from "react";
import { createWidget, type CreateWidgetState } from "./actions";

const initialState: CreateWidgetState = { ok: false, message: "" };

export function CreateWidgetForm() {
  const [state, formAction, pending] = useActionState(
    createWidget,
    initialState
  );

  return (
    <form action={formAction} className="opera-card flex flex-col gap-5 p-6">
      <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-opera-gold">
        Create a widget
      </h2>

      <Field label="Name" htmlFor="name">
        <input
          id="name"
          name="name"
          required
          maxLength={120}
          placeholder="My Shopify store"
          className="opera-input"
        />
      </Field>

      <Field
        label="Allowed origins"
        htmlFor="allowed_origins"
        hint="One per line. Only these origins will be allowed to embed the widget."
      >
        <textarea
          id="allowed_origins"
          name="allowed_origins"
          rows={3}
          placeholder={"https://shop.example.com\nhttps://staging.example.com"}
          className="opera-input font-mono text-sm"
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Primary color" htmlFor="primary_color">
          <input
            id="primary_color"
            name="primary_color"
            defaultValue="#B08A3E"
            pattern="^#[0-9a-fA-F]{6}$"
            className="opera-input font-mono text-sm"
          />
        </Field>
        <Field label="Position" htmlFor="position">
          <select
            id="position"
            name="position"
            defaultValue="bottom-right"
            className="opera-input"
          >
            <option value="bottom-right">Bottom right</option>
            <option value="bottom-left">Bottom left</option>
            <option value="top-right">Top right</option>
            <option value="top-left">Top left</option>
          </select>
        </Field>
        <Field label="Voice" htmlFor="voice">
          <select
            id="voice"
            name="voice"
            defaultValue="verse"
            className="opera-input"
          >
            <option value="verse">Verse</option>
            <option value="alloy">Alloy</option>
            <option value="echo">Echo</option>
            <option value="shimmer">Shimmer</option>
            <option value="ballad">Ballad</option>
            <option value="ash">Ash</option>
            <option value="sage">Sage</option>
            <option value="coral">Coral</option>
          </select>
        </Field>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p
          className={`text-xs ${
            state.ok
              ? "text-opera-gold"
              : state.message
              ? "text-red-300"
              : "text-opera-muted"
          }`}
          aria-live="polite"
        >
          {state.message || "All fields required unless marked optional."}
        </p>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center justify-center rounded-full bg-opera-gold px-5 text-sm font-medium text-opera-black transition hover:bg-opera-amber disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create widget"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-[0.16em] text-opera-muted">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="text-xs text-opera-muted/80">{hint}</span>
      ) : null}
    </label>
  );
}
