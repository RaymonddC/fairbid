import type { CSSProperties } from "react";
import { DEMO_USERS } from "@/lib/auth";
import { AuthPanel } from "./AuthPanel";
import { LogoMark } from "./Logo";
import { TenderSheet } from "./TenderSheet";
import { ThemeToggle } from "./ThemeToggle";

/** Staggers the page-load entrance: `--i` is the element's place in the order. */
const order = (i: number) => ({ "--i": i }) as CSSProperties;

const HEADLINE = "The lowest quote is rarely the lowest cost.";

/**
 * Shared by /login and /register, full screen with the app nav hidden, on one screen with no
 * scrolling: the indigo side lays a real tender sheet on the desk, the plain side signs you in.
 */
export function AuthPage({ initial, next }: { initial: "login" | "register"; next: string }) {
  return (
    <div className="fixed inset-0 z-30 grid grid-rows-[auto_minmax(0,1fr)] overflow-y-auto bg-canvas lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)] lg:grid-rows-none">
      {/* Clipped, so the sheets under the tender never push the page into a scroll. */}
      <aside className="auth-brand relative isolate flex flex-col gap-2 overflow-clip px-5 py-3 sm:px-10 sm:py-5 lg:min-h-dvh lg:gap-8 lg:px-14 lg:py-7">
        <div className="auth-rise flex flex-wrap items-center justify-between gap-3" style={order(0)}>
          <span className="flex items-center gap-3">
            <LogoMark size={36} />
            <span className="text-[17px] font-semibold tracking-tight">FairBid</span>
          </span>
          <span className="rounded-full px-3 py-1 text-xs text-white/75 ring-1 ring-inset ring-white/20">PayPal sandbox, no real money</span>
        </div>

        {/* Below desktop the brand side is a slim header, so the whole page fits one screen. */}
        <h1 className="auth-rise font-sans! text-sm font-normal! tracking-normal! text-white/80 lg:hidden [@media(max-height:660px)]:sr-only" style={order(2)}>
          {HEADLINE}
        </h1>

        <div className="hidden min-h-0 flex-1 flex-col justify-start gap-7 pt-[6vh] lg:flex">
          <h1 className="auth-headline auth-rise max-w-[18ch]" style={order(1)}>
            {HEADLINE}
          </h1>
          <div className="auth-rise w-full max-w-[600px]" style={order(3)}>
            <TenderSheet />
          </div>
        </div>
      </aside>

      <div className="flex flex-col px-5 pb-4 pt-3 sm:px-10 sm:pb-8 lg:min-h-dvh lg:px-14 lg:py-3">
        {/* On a phone the theme follows the system, which keeps the form on one screen. */}
        <div className="auth-rise mb-4 hidden justify-end sm:flex short:mb-1" style={order(1)}>
          <ThemeToggle compact />
        </div>
        {/* On a roomy desktop the form sits on a slip of the same paper as the tender sheet. */}
        <div
          className="auth-rise m-auto w-full max-w-[420px] roomy:max-w-[468px] roomy:rounded-[3px] roomy:border roomy:border-line roomy:bg-[var(--slip)] roomy:px-7 roomy:py-7 roomy:shadow-[0_1px_2px_rgb(15_18_34/0.08),0_6px_14px_-8px_rgb(15_18_34/0.18)]"
          style={order(3)}
        >
          <AuthPanel
            initial={initial}
            next={next}
            demoAccounts={DEMO_USERS.map((u) => ({ id: u.id, name: u.name, role: u.role, detail: u.detail }))}
          />
        </div>
      </div>
    </div>
  );
}
