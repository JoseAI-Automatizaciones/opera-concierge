"use client";

import { useActionState } from "react";
import type { WidgetRowSafe } from "@/lib/supabase/types";
import { updateWidget, type UpdateWidgetState } from "../actions";

const initialState: UpdateWidgetState = { ok: false, message: "" };

export function EditWidgetForm({ widget }: { widget: WidgetRowSafe }) {
  const boundAction = updateWidget.bind(null, widget.id);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="opera-card flex flex-col gap-5 p-6">
      <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-opera-gold">
        Edit widget
      </h2>

      <Field label="Name" htmlFor="name">
        <input
          id="name"
          name="name"
          required
          maxLength={120}
          defaultValue={widget.name}
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
          defaultValue={widget.allowed_origins.join("\n")}
          className="opera-input font-mono text-sm"
        />
      </Field>

      <Field
        label="System prompt"
        htmlFor="system_prompt"
        hint="Instructions for the agent. Be directive — tell it to execute actions, not ask. Leave blank for the OpenAI default."
      >
        <textarea
          id="system_prompt"
          name="system_prompt"
          rows={10}
          maxLength={8000}
          defaultValue={widget.system_prompt ?? ""}
          className="opera-input font-mono text-sm"
        />
      </Field>

      <Field
        label="OpenAI API key"
        htmlFor="openai_api_key"
        hint={
          widget.has_openai_api_key
            ? "A key is configured. Leave blank to keep it; type a new one to replace."
            : "⚠ No key configured. Paste your OpenAI key (starts with sk-)."
        }
      >
        <input
          id="openai_api_key"
          name="openai_api_key"
          type="password"
          autoComplete="off"
          minLength={widget.has_openai_api_key ? 0 : 20}
          maxLength={500}
          placeholder={widget.has_openai_api_key ? "•••••• (unchanged)" : "sk-…"}
          className="opera-input font-mono text-sm"
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Primary color" htmlFor="primary_color">
          <input
            id="primary_color"
            name="primary_color"
            defaultValue={widget.primary_color}
            pattern="^#[0-9a-fA-F]{6}$"
            className="opera-input font-mono text-sm"
          />
        </Field>
        <Field label="Position" htmlFor="position">
          <select
            id="position"
            name="position"
            defaultValue={widget.position}
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
            defaultValue={widget.voice}
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
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Sessions / minute" htmlFor="max_sessions_per_minute">
            <input
              id="max_sessions_per_minute"
              name="max_sessions_per_minute"
              type="number"
              min={1}
              max={1000}
              defaultValue={widget.max_sessions_per_minute}
              className="opera-input font-mono text-sm"
            />
          </Field>
          <Field label="Sessions / day" htmlFor="max_sessions_per_day">
            <input
              id="max_sessions_per_day"
              name="max_sessions_per_day"
              type="number"
              min={1}
              max={100000}
              defaultValue={widget.max_sessions_per_day}
              className="opera-input font-mono text-sm"
            />
          </Field>
          <Field label="Max seconds / session" htmlFor="max_session_seconds">
            <input
              id="max_session_seconds"
              name="max_session_seconds"
              type="number"
              min={30}
              max={7200}
              defaultValue={widget.max_session_seconds}
              className="opera-input font-mono text-sm"
            />
          </Field>
          <Field
            label="Max tokens / response"
            htmlFor="max_response_output_tokens"
          >
            <input
              id="max_response_output_tokens"
              name="max_response_output_tokens"
              type="number"
              min={100}
              max={4096}
              defaultValue={widget.max_response_output_tokens}
              className="opera-input font-mono text-sm"
            />
          </Field>
        </div>
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
          {state.message || "Changes apply to new sessions only."}
        </p>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center justify-center rounded-full bg-opera-gold px-5 text-sm font-medium text-opera-black transition hover:bg-opera-amber disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save changes"}
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
