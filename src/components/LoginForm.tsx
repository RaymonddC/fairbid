"use client";

import { useActionState, useState } from "react";
import { passwordSignInAction, type PasswordSignInState } from "@/app/login/actions";
import { Spinner } from "./Loading";

const field =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none placeholder:text-faint focus:border-dye focus:ring-2 focus:ring-dye/15 aria-[invalid=true]:border-flag";

/** Email and password sign-in. Errors are announced and tied to the fields. */
export function LoginForm({ next, demoEmail, demoPassword }: { next: string; demoEmail: string; demoPassword: string }) {
  const [state, action, pending] = useActionState<PasswordSignInState, FormData>(passwordSignInAction, { error: null, email: "" });
  const [show, setShow] = useState(false);
  const invalid = !!state.error;

  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <div className="grid gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          placeholder={demoEmail}
          aria-invalid={invalid}
          aria-describedby={invalid ? "login-error" : undefined}
          className={field}
        />
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <button type="button" onClick={() => setShow((s) => !s)} className="text-xs text-muted underline underline-offset-4 hover:text-ink">
            {show ? "Hide" : "Show"}
          </button>
        </div>
        <input
          id="password"
          name="password"
          type={show ? "text" : "password"}
          autoComplete="current-password"
          required
          aria-invalid={invalid}
          aria-describedby={invalid ? "login-error" : undefined}
          className={field}
        />
      </div>
      {state.error && (
        <p id="login-error" role="alert" className="rounded-lg bg-flag-soft px-3 py-2 text-sm text-flag">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-dye px-4 text-sm font-medium text-canvas hover:bg-dye-hover disabled:opacity-60"
      >
        {pending && <Spinner size={15} label="Signing in" />}
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-xs text-muted">
        Judges: sign in as the buyer with <span className="ref text-ink">{demoEmail}</span> and the password{" "}
        <span className="ref text-ink">{demoPassword}</span>, or pick a demo account.
      </p>
    </form>
  );
}
