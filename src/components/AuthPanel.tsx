"use client";

import { useActionState, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import {
  passwordSignInAction,
  registerAction,
  signInAction,
  type PasswordSignInState,
  type RegisterField,
  type RegisterState,
} from "@/app/login/actions";
import { roleLabel } from "@/lib/auth";
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
 * Sign in and create account as one card, each with a link to the other. Switching slides the
 * forms sideways and changes the address (/login or /register) without reloading, so Back works.
 * The hidden form is inert, so keyboard and screen readers only reach the visible one.
 */
export function AuthPanel({
  initial,
  next,
  demoAccounts,
}: {
  initial: Mode;
  next: string;
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
    <section className="overflow-hidden">
      <div
        className="auth-height overflow-hidden"
        style={{ height }}
      >
        <div
          className="auth-slide flex w-[200%] items-start"
          style={{ transform: mode === "register" ? "translateX(-50%)" : "none" }}
        >
          <Pane id="login" title="Sign in to FairBid" active={mode === "login"} paneRef={(el) => (panes.current.login = el)}>
            <p className="-mt-2 text-sm text-muted">Open the demo tender as Anna or Sari. No password needed.</p>
            <DemoAccounts accounts={demoAccounts} next={next} />
            <p className="border-t border-line pt-4 text-sm font-medium">Or sign in with your own account</p>
            <LoginFields next={next} />
            <Switch prompt="New to FairBid?" action="Create an account" onClick={() => go("register")} />
          </Pane>
          <Pane id="register" title="Create your account" active={mode === "register"} paneRef={(el) => (panes.current.register = el)}>
            <RegisterFields />
            <Switch prompt="Already have an account?" action="Sign in" onClick={() => go("login")} />
          </Pane>
        </div>
      </div>
    </section>
  );
}

function Pane({
  id,
  title,
  active,
  paneRef,
  children,
}: {
  id: Mode;
  title: string;
  active: boolean;
  paneRef: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  return (
    <section
      ref={paneRef}
      aria-labelledby={`title-${id}`}
      inert={!active}
      className={`grid w-1/2 content-start gap-4 p-1 transition-opacity duration-200 sm:gap-5 short:gap-3.5 ${active ? "opacity-100" : "opacity-0"}`}
    >
      <h2 id={`title-${id}`} className="text-[22px] leading-tight tracking-[-0.025em] sm:text-[26px] short:text-[22px]">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The quiet way across to the other form, under the one on screen. */
function Switch({ prompt, action, onClick }: { prompt: string; action: string; onClick: () => void }) {
  return (
    <p className="-my-2 text-sm text-muted">
      {prompt}{" "}
      <button type="button" onClick={onClick} className="inline-flex min-h-11 items-center font-medium text-dye underline-offset-4 hover:underline">
        {action}
      </button>
    </p>
  );
}

const field =
  "min-h-11 w-full rounded-lg sm:min-h-12 border border-line-strong bg-surface px-3.5 text-sm outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-faint focus:border-dye focus:ring-2 focus:ring-dye/15 aria-[invalid=true]:border-flag";

function LoginFields({ next }: { next: string }) {
  const [state, action, pending] = useActionState<PasswordSignInState, FormData>(passwordSignInAction, { error: null, email: "" });
  // A missing field marks only that field; a wrong pair marks both.
  const badEmail = !!state.error && state.field !== "password";
  const badPassword = !!state.error && state.field !== "email";
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
          placeholder="you@company.com"
          aria-invalid={badEmail}
          aria-describedby={badEmail ? "login-error" : undefined}
          className={field}
        />
      </Field>
      <PasswordField id="login-password" autoComplete="current-password" invalid={badPassword} describedBy={badPassword ? "login-error" : undefined} />
      {state.error && <ErrorNote id="login-error">{state.error}</ErrorNote>}
      {/* Quiet on purpose: the demo accounts above are the screen's main way in. */}
      <Submit pending={pending} busy="Signing in…" quiet>
        Sign in
      </Submit>
    </form>
  );
}

const REGISTER_INPUT: Record<RegisterField, string> = {
  name: "reg-name",
  email: "reg-email",
  password: "reg-password",
  country: "reg-country",
  paypalEmail: "reg-paypal",
};

function RegisterFields() {
  const [state, action, pending] = useActionState<RegisterState, FormData>(registerAction, { error: null, values: {} });
  const [role, setRole] = useState<"buyer" | "seller">(state.values.role === "seller" ? "seller" : "buyer");
  const errors = state.errors ?? {};
  const bad = (f: RegisterField) => !!errors[f];

  // After a failed try, the first field to fix gets the focus, which also scrolls it into view.
  useEffect(() => {
    const first = (["name", "email", "password", "country", "paypalEmail"] as const).find((f) => state.errors?.[f]);
    if (first) document.getElementById(REGISTER_INPUT[first])?.focus();
  }, [state]);
  // An input is described by its own error, when it has one, and any hint.
  const describe = (f: RegisterField, ...more: string[]) => [errors[f] ? `${f}-error` : null, ...more].filter(Boolean).join(" ") || undefined;
  return (
    <form action={action} className="grid gap-3 sm:gap-4 short:gap-3" noValidate>
      <fieldset className="grid gap-1.5">
        <legend className="sr-only text-sm font-medium sm:not-sr-only sm:mb-1.5">I want to</legend>
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
              className={`relative min-h-11 rounded-md px-3 font-medium transition-colors sm:min-h-10 ${role === r ? "text-ink" : "text-muted hover:text-ink"}`}
            >
              {r === "buyer" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>
      </fieldset>

      <Field id="reg-name" label={role === "seller" ? "Your name or workshop" : "Your name or company"} error={errors.name} errorId="name-error">
        <input
          id="reg-name"
          name="name"
          autoComplete="organization"
          defaultValue={state.values.name}
          aria-invalid={bad("name")}
          aria-describedby={describe("name")}
          className={field}
        />
      </Field>
      {/* Paired from tablet width up, so the whole form fits one screen. */}
      <div className="grid items-start gap-4 sm:grid-cols-2 sm:gap-3">
        <Field id="reg-email" label="Email" error={errors.email} errorId="email-error">
          <input
            id="reg-email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={state.values.email}
            aria-invalid={bad("email")}
            aria-describedby={describe("email")}
            className={field}
          />
        </Field>
        <PasswordField
          id="reg-password"
          autoComplete="new-password"
          invalid={bad("password")}
          describedBy={describe("password")}
          hint="8 or more characters"
          error={errors.password}
          errorId="password-error"
        />
      </div>

      {/* Seller-only details open smoothly below, so the form grows instead of jumping. */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
          role === "seller" ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
        inert={role !== "seller"}
      >
        <div className="grid grid-cols-2 items-start gap-x-3 gap-y-4 overflow-hidden">
          <Field id="reg-country" label="Ships from" error={errors.country} errorId="country-error">
            <select
              id="reg-country"
              name="country"
              defaultValue={state.values.country || "ID"}
              aria-invalid={bad("country")}
              aria-describedby={describe("country")}
              className={field}
            >
              {SELLER_COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {countryName(c)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="reg-paypal" label="PayPal email" error={errors.paypalEmail} errorId="paypalEmail-error">
            <input
              id="reg-paypal"
              name="paypalEmail"
              type="email"
              autoComplete="off"
              defaultValue={state.values.paypalEmail}
              aria-invalid={bad("paypalEmail")}
              aria-describedby={describe("paypalEmail", "reg-paypal-hint")}
              className={field}
            />
          </Field>
          <p id="reg-paypal-hint" className="col-span-2 -mt-2 text-xs text-muted">
            A PayPal sandbox business account. Tender owners pay you here.
          </p>
        </div>
      </div>

      {state.error && <ErrorNote id="reg-error">{state.error}</ErrorNote>}
      <Submit pending={pending} busy="Creating your account…">
        Create account
      </Submit>
    </form>
  );
}

/** Who each demo person is, short enough for the button. */
const DEMO_LINE: Record<string, string> = {
  "buyer-anna": "Tender owner · Berlin",
  "seller-sari": "Bidder · Yogyakarta",
};

function DemoAccounts({ accounts, next }: { accounts: DemoAccount[]; next: string }) {
  return (
    <form action={signInAction} className="grid grid-cols-2 gap-2">
      <input type="hidden" name="next" value={next} />
      {accounts.map((a) => (
        <DemoButton key={a.id} account={a} />
      ))}
    </form>
  );
}

/** One form for both people: the clicked one says it is opening, and both wait, so a slow first load is not clicked twice. */
function DemoButton({ account: a }: { account: DemoAccount }) {
  const { pending, data } = useFormStatus();
  const opening = pending && data?.get("userId") === a.id;
  return (
    <button
      type="submit"
      name="userId"
      value={a.id}
      disabled={pending}
      aria-label={`Continue as ${a.name}, the demo ${roleLabel(a.role).toLowerCase()}: ${a.detail}`}
      className="auth-press flex min-h-14 w-full items-center gap-2.5 rounded-lg border border-dye/35 bg-dye-soft/50 px-3 py-2 text-left transition-colors hover:border-dye hover:bg-dye-soft disabled:opacity-80"
    >
      <Avatar id={a.id} size={30} />
      <span className="grid min-w-0 leading-tight">
        <span className="text-sm font-medium">{a.name}</span>
        <span className="text-xs text-muted">{opening ? "Opening…" : (DEMO_LINE[a.id] ?? a.role)}</span>
      </span>
      {opening && <Spinner size={14} label={`Opening ${a.name}'s view`} />}
    </button>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  errorId,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

/** A field's own problem, right under it. */
function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="text-xs text-flag">
      {children}
    </p>
  );
}

function PasswordField({
  id,
  autoComplete,
  invalid,
  describedBy,
  hint,
  error,
  errorId,
}: {
  id: string;
  autoComplete: string;
  invalid: boolean;
  describedBy?: string;
  hint?: string;
  error?: string;
  errorId?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="grid gap-1.5">
      {/* The hint shares the label's line, so the form stays one screen tall on a phone. */}
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          Password
        </label>
        {hint && (
          <span id={`${id}-hint`} className="text-xs text-muted">
            {hint}
          </span>
        )}
      </div>
      {/* Show sits inside the field, after it in the Tab order, and is a full-size target. */}
      <div className="relative">
        <input
          id={id}
          name="password"
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          aria-invalid={invalid}
          aria-describedby={[describedBy, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined}
          className={`${field} pr-16`}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-controls={id}
          aria-pressed={show}
          className="absolute inset-y-0 right-0 min-w-12 rounded-r-lg px-3 text-xs font-medium text-muted hover:bg-canvas hover:text-ink"
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
      {error && <FieldError id={errorId}>{error}</FieldError>}
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

function Submit({ pending, busy, quiet = false, children }: { pending: boolean; busy: string; quiet?: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={`auth-press inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium disabled:opacity-60 ${
        quiet ? "border border-line-strong bg-surface text-ink hover:bg-canvas" : "bg-dye text-canvas hover:bg-dye-hover"
      }`}
    >
      {pending && <Spinner size={15} label={busy} />}
      {pending ? busy : children}
    </button>
  );
}
