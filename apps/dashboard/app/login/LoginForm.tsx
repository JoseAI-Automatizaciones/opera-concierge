"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm({ initialError }: { initialError: string | null }) {
  const initial: LoginState = initialError
    ? { ok: false, message: initialError }
    : { ok: false, message: "" };

  const [state, formAction, pending] = useActionState(sendMagicLink, initial);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      <label htmlFor="email" className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-[0.16em] text-opera-muted">
          Email
        </span>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          className="opera-input"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center rounded-full bg-opera-gold px-5 text-sm font-medium text-opera-black transition hover:bg-opera-amber disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send magic link"}
      </button>

      {state.message ? (
        <p
          className={`text-xs ${state.ok ? "text-opera-amber" : "text-red-300"}`}
          aria-live="polite"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
