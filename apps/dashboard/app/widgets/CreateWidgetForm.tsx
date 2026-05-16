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

      <fieldset className="rounded-2xl border border-white/[0.06] p-5">
        <legend className="px-2 text-xs font-medium uppercase tracking-[0.18em] text-opera-gold">
          Usage limits
        </legend>
        <p className="mb-4 text-xs text-opera-muted/80">
          Protects your OpenAI bill from runaway visitors. Limits apply per
          visitor (currently per IP).
        </p>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field
            label="Sessions / minute"
            htmlFor="max_sessions_per_minute"
            hint="Burst rate. Default 5."
          >
            <input
              id="max_sessions_per_minute"
              name="max_sessions_per_minute"
              type="number"
              min={1}
              max={1000}
              defaultValue={5}
              className="opera-input font-mono text-sm"
            />
          </Field>
          <Field
            label="Sessions / day"
            htmlFor="max_sessions_per_day"
            hint="Daily cap. Default 15."
          >
            <input
              id="max_sessions_per_day"
              name="max_sessions_per_day"
              type="number"
              min={1}
              max={100000}
              defaultValue={15}
              className="opera-input font-mono text-sm"
            />
          </Field>
          <Field
            label="Max seconds / session"
            htmlFor="max_session_seconds"
            hint="Auto-end the session. Default 480 (8 min)."
          >
            <input
              id="max_session_seconds"
              name="max_session_seconds"
              type="number"
              min={30}
              max={7200}
              defaultValue={480}
              className="opera-input font-mono text-sm"
            />
          </Field>
          <Field
            label="Max tokens / response"
            htmlFor="max_response_output_tokens"
            hint="Caps each assistant reply at mint time. Default 4096."
          >
            <input
              id="max_response_output_tokens"
              name="max_response_output_tokens"
              type="number"
              min={100}
              max={4096}
              defaultValue={4096}
              className="opera-input font-mono text-sm"
            />
          </Field>
        </div>
        <p className="mt-4 text-xs text-opera-muted/70">
          ⚠ These caps protect against well-behaved clients only. A determined
          attacker can override session config during the WebRTC handshake.
          Your real billing brake is your OpenAI account spending limit — set
          it in your OpenAI dashboard.
        </p>
      </fieldset>

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
