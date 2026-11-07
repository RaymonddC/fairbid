"use client";

import { useActionState, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { passwordSignInAction, registerAction, signInAction, type PasswordSignInState, type RegisterState } from "@/app/login/actions";
import { SELLER_COUNTRIES, countryName } from "@/lib/format";
import { Avatar } from "./Avatar";
import { Spinner } from "./Loading";

type Mode = "login" | "register";

export interface DemoAccount {
  id: string;
  name: string;
  role: string;
  detail: string;
}

const PATH: Record<Mode, string> = { login: "/login", register: "/register" };

/**
 * Sign in and create account as one card. Switching slides the forms sideways inside the
 * card and changes the address (/login or /register) without reloading, so Back works.
 * The hidden form is inert, so keyboard and screen readers only reach the visible one.
 */
export function AuthPanel({
  initial,
  next,
  demoEmail,
  demoPassword,
  demoAccounts,
}: {
  initial: Mode;
  next: string;
  demoEmail: string;
  demoPassword: string;
  demoAccounts: DemoAccount[];
}) {
  const [mode, setMode] = useState<Mode>(initial);
  const panes = useRef<Record<Mode, HTMLDivElement | null>>({ login: null, register: null });
  const [height, setHeight] = useState<number | undefined>(undefined);

  const go = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    window.history.pushState({ auth: m }, "", PATH[m] + window.location.search);
  };

  // The tab title follows the form on screen.
  useEffect(() => {
    const title = mode === "login" ? "Sign in · FairBid" : "Create account · FairBid";
    if (document.title !== title) Object.assign(document, { title });
  }, [mode]);

  // Back and forward between /login and /register switch the card too.
  useEffect(() => {
    const onPop = () => setMode(window.location.pathname === "/register" ? "register" : "login");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // The card takes the height of the visible form, and follows it as errors or fields appear.
  useLayoutEffect(() => {
    const el = panes.current[mode];
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  return (
    <section className="notice overflow-hidden rounded-2xl" aria-label="Sign in or create an account">
      <div className="relative grid grid-cols-2 border-b border-line text-sm" role="tablist" aria-label="Account">
        {(["login", "register"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            id={`tab-${m}`}
            aria-selected={mode === m}
            aria-controls={`pane-${m}`}
            onClick={() => go(m)}
            className={`min-h-12 font-medium transition-colors ${mode === m ? "text-ink" : "text-muted hover:text-ink"}`}
          >
            {m === "login" ? "Sign in" : "Create account"}
          </button>
        ))}
        <span
          className="absolute bottom-0 left-0 h-0.5 w-1/2 bg-dye transition-transform duration-500 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none"
          style={{ transform: mode === "register" ? "translateX(100%)" : "none" }}
          aria-hidden="true"
        />
      </div>

      <div
        className="overflow-hidden transition-[height] duration-500 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none"
        style={{ height }}
      >
        <div
          className="flex w-[200%] items-start transition-transform duration-500 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none"
          style={{ transform: mode === "register" ? "translateX(-50%)" : "none" }}
        >
          <Pane id="login" active={mode === "login"} paneRef={(el) => (panes.current.login = el)}>
            <h2 className="text-xl">Welcome back</h2>
            <p className="-mt-2 text-sm text-muted">Sign in to run your tenders or your bids.</p>
            <LoginFields next={next} demoEmail={demoEmail} />
            <p className="text-sm text-muted">
              New to FairBid?{" "}
              <button type="button" onClick={() => go("register")} className="font-medium text-dye underline underline-offset-4">
                Create an account
              </button>
            </p>
            <DemoAccounts accounts={demoAccounts} next={next} demoEmail={demoEmail} demoPassword={demoPassword} />
          </Pane>
          <Pane id="register" active={mode === "register"} paneRef={(el) => (panes.current.register = el)}>
            <h2 className="text-xl">Create your account</h2>
            <p className="-mt-2 text-sm text-muted">Buy through sealed tenders, or sell to buyers abroad. Sandbox money only.</p>
            <RegisterFields />
            <p className="text-sm text-muted">
              Already have an account?{" "}
              <button type="button" onClick={() => go("login")} className="font-medium text-dye underline underline-offset-4">
                Sign in
              </button>
            </p>
          </Pane>
        </div>
      </div>
    </section>
  );
}

function Pane({ id, active, paneRef, children }: { id: Mode; active: boolean; paneRef: (el: HTMLDivElement | null) => void; children: ReactNode }) {
  return (
    <div
      ref={paneRef}
      id={`pane-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      inert={!active}
      className={`grid w-1/2 gap-5 p-6 transition-opacity duration-300 sm:p-8 ${active ? "opacity-100" : "opacity-0"}`}
    >
      {children}
    </div>
  );
}

const field =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none placeholder:text-faint focus:border-dye focus:ring-2 focus:ring-dye/15 aria-[invalid=true]:border-flag";

function LoginFields({ next, demoEmail }: { next: string; demoEmail: string }) {
  const [state, action, pending] = useActionState<PasswordSignInState, FormData>(passwordSignInAction, { error: null, email: "" });
  const invalid = !!state.error;
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Field id="login-email" label="Email">
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state.email}
          placeholder={demoEmail}
          aria-invalid={invalid}
          aria-describedby={invalid ? "login-error" : undefined}
          className={field}
        />
      </Field>
      <PasswordField id="login-password" autoComplete="current-password" invalid={invalid} describedBy={invalid ? "login-error" : undefined} />
      {state.error && <ErrorNote id="login-error">{state.error}</ErrorNote>}
      <Submit pending={pending} busy="Signing in…">
        Sign in
      </Submit>
    </form>
  );
}

function RegisterFields() {
  const [state, action, pending] = useActionState<RegisterState, FormData>(registerAction, { error: null, values: {} });
  const [role, setRole] = useState<"buyer" | "seller">(state.values.role === "seller" ? "seller" : "buyer");
  const bad = (f: RegisterState["field"]) => state.field === f;
  return (
    <form action={action} className="grid gap-4" noValidate>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">I want to</legend>
        <input type="hidden" name="role" value={role} />
        <div className="relative grid grid-cols-2 rounded-lg bg-canvas p-1 text-sm ring-1 ring-inset ring-line" role="radiogroup" aria-label="Account type">
          <span
            className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-md bg-surface shadow-[0_1px_2px_rgba(21,26,45,0.12),0_0_0_1px_rgba(21,26,45,0.06)] transition-transform duration-300 ease-out motion-reduce:transition-none"
            style={{ transform: role === "seller" ? "translateX(100%)" : "none" }}
            aria-hidden="true"
          />
          {(["buyer", "seller"] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={role === r}
              onClick={() => setRole(r)}
              className={`relative grid min-h-12 content-center rounded-md px-3 text-center transition-colors ${role === r ? "text-ink" : "text-muted hover:text-ink"}`}
            >
              <span className="font-medium">{r === "buyer" ? "Buy" : "Sell"}</span>
              <span className="text-xs text-muted">{r === "buyer" ? "Post tenders, pay on delivery" : "Bid on tenders abroad"}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <Field id="reg-name" label={role === "seller" ? "Your name or workshop" : "Your name or company"}>
        <input id="reg-name" name="name" autoComplete="organization" defaultValue={state.values.name} aria-invalid={bad("name")} className={field} />
      </Field>
      <Field id="reg-email" label="Email">
        <input id="reg-email" name="email" type="email" autoComplete="email" defaultValue={state.values.email} aria-invalid={bad("email")} className={field} />
      </Field>
      <PasswordField id="reg-password" autoComplete="new-password" invalid={bad("password")} hint="At least 8 characters." />

      {/* Seller-only details open smoothly below, so the form grows instead of jumping. */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
          role === "seller" ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
        inert={role !== "seller"}
      >
        <div className="grid gap-4 overflow-hidden">
          <Field id="reg-country" label="Ships from">
            <select id="reg-country" name="country" defaultValue={state.values.country || "ID"} className={field}>
              {SELLER_COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {countryName(c)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="reg-paypal" label="PayPal email for payments" hint="Use a PayPal sandbox business account. Buyers' payments go here.">
            <input
              id="reg-paypal"
              name="paypalEmail"
              type="email"
              autoComplete="off"
              defaultValue={state.values.paypalEmail}
              aria-invalid={bad("paypalEmail")}
              className={field}
            />
          </Field>
        </div>
      </div>

      {state.error && <ErrorNote id="reg-error">{state.error}</ErrorNote>}
      <Submit pending={pending} busy="Creating your account…">
        Create account
      </Submit>
    </form>
  );
}

function DemoAccounts({ accounts, next, demoEmail, demoPassword }: { accounts: DemoAccount[]; next: string; demoEmail: string; demoPassword: string }) {
  return (
    <div className="grid gap-3 border-t border-line pt-5">
      <div className="flex items-center gap-3 text-xs text-faint">
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
        Or try a demo account, no password
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {accounts.map((a) => (
          <form key={a.id} action={signInAction}>
            <input type="hidden" name="userId" value={a.id} />
            <input type="hidden" name="next" value={next} />
            <button
              type="submit"
              className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-line-strong bg-surface px-3 text-left transition-colors hover:border-dye hover:bg-dye-soft/40"
            >
              <Avatar id={a.id} size={36} />
              <span className="grid min-w-0 leading-tight">
                <span className="text-sm font-medium">{a.name}</span>
                <span className="truncate text-xs capitalize text-muted">{a.role}, {a.detail}</span>
              </span>
            </button>
          </form>
        ))}
      </div>
      <p className="text-xs text-muted">
        Judges can also sign in with <span className="ref text-ink">{demoEmail}</span> and <span className="ref text-ink">{demoPassword}</span>.
      </p>
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

function PasswordField({
  id,
  autoComplete,
  invalid,
  describedBy,
  hint,
}: {
  id: string;
  autoComplete: string;
  invalid: boolean;
  describedBy?: string;
  hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium">
          Password
        </label>
        <button type="button" onClick={() => setShow((s) => !s)} aria-controls={id} className="text-xs text-muted underline underline-offset-4 hover:text-ink">
          {show ? "Hide" : "Show"}
        </button>
      </div>
      <input id={id} name="password" type={show ? "text" : "password"} autoComplete={autoComplete} aria-invalid={invalid} aria-describedby={describedBy} className={field} />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

function ErrorNote({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="rounded-lg bg-flag-soft px-3 py-2 text-sm text-flag">
      {children}
    </p>
  );
}

function Submit({ pending, busy, children }: { pending: boolean; busy: string; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-dye px-4 text-sm font-medium text-canvas transition-colors hover:bg-dye-hover disabled:opacity-60"
    >
      {pending && <Spinner size={15} label={busy} />}
      {pending ? busy : children}
    </button>
  );
}
