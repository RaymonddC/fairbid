import type { CSSProperties } from "react";
import { DEMO_EMAILS, DEMO_PASSWORD } from "@/lib/accounts";
import { DEMO_USERS } from "@/lib/auth";
import { money } from "@/lib/format";
import { AuthPanel } from "./AuthPanel";
import { Avatar } from "./Avatar";
import { LogoMark } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

/** Staggers the page-load entrance: `--i` is the element's place in the order. */
const order = (i: number) => ({ "--i": i }) as CSSProperties;

const HEADLINE = ["The lowest quote", "is rarely the", "lowest cost."];

/**
 * Shared by /login and /register, full screen with the app nav hidden: the indigo side
 * proves the headline with one example tender, the plain side signs you in. The logo appears once.
 */
export function AuthPage({ initial, next }: { initial: "login" | "register"; next: string }) {
  return (
    <div className="fixed inset-0 z-30 grid overflow-y-auto bg-canvas lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)]">
      <aside className="auth-brand relative isolate flex flex-col justify-between gap-5 px-6 py-6 sm:px-10 sm:py-8 lg:min-h-dvh lg:px-14 lg:py-7">
        <div className="auth-rise flex flex-wrap items-center justify-between gap-3" style={order(0)}>
          <span className="flex items-center gap-3">
            <LogoMark size={36} />
            <span className="text-[17px] font-semibold tracking-tight">FairBid</span>
          </span>
          <span className="rounded-full px-3 py-1 text-xs text-white/75 ring-1 ring-inset ring-white/20">PayPal sandbox, no real money</span>
        </div>

        <div className="grid gap-3">
          <h1 className="auth-headline">
            {HEADLINE.map((line, i) => (
              <span key={line} className="auth-line">
                <span className="auth-line-in" style={order(i)}>
                  {line}
                </span>
              </span>
            ))}
          </h1>
          <p className="auth-rise max-w-[52ch] text-[15px] leading-relaxed text-white/75" style={order(5)}>
            Get sealed bids from makers abroad, see what each one really costs delivered, and pay only as the order moves.
          </p>
        </div>

        <p className="auth-glass auth-rise rounded-xl p-3.5 text-sm leading-relaxed sm:hidden" style={order(6)}>
          <span className="mb-0.5 block text-xs text-white/70">Example tender, 300 batik napkins</span>
          Lowest quote {eur(2250)}, but <strong className="font-semibold">{eur(3050)} delivered</strong>. Best delivered offer{" "}
          <strong className="font-semibold text-sun">{eur(2880)}</strong>.
        </p>

        <div className="auth-rise hidden sm:block" style={order(6)}>
          <BidStory />
        </div>
      </aside>

      <div className="flex flex-col px-5 pb-10 pt-5 sm:px-10 lg:min-h-dvh lg:px-14 lg:py-6">
        <div className="auth-rise mb-4 flex justify-end" style={order(1)}>
          <ThemeToggle compact />
        </div>
        <div className="auth-rise m-auto w-full max-w-[420px]" style={order(3)}>
          <AuthPanel
            initial={initial}
            next={next}
            demoEmail={DEMO_EMAILS["buyer-anna"]}
            demoPassword={DEMO_PASSWORD}
            demoAccounts={DEMO_USERS.map((u) => ({ id: u.id, name: u.name, role: u.role, detail: u.detail }))}
          />
        </div>
      </div>
    </div>
  );
}

// The demo tender's own figures, in euros: what each seller quoted, and what it costs delivered.
const BIDS = [
  { letter: "A", note: "Lowest quote", quoted: 2250, delivered: 3050 },
  { letter: "B", note: "⚑ Flagged", quoted: 2400, delivered: 3078 },
  { letter: "C", note: "⚑ Flagged", quoted: 2410, delivered: 3089 },
  { letter: "D", note: "Sari's workshop", quoted: 2290, delivered: 2880 },
];
const BUDGET = 3000;
const SCALE = 3250;
const MILESTONES = [
  { name: "Production", amount: 762, pct: 30 },
  { name: "Shipped", amount: 1016, pct: 40 },
  { name: "Delivered", amount: 762, pct: 30 },
];
const ROW = "grid grid-cols-[112px_minmax(0,1fr)_52px_56px] items-center gap-2.5";

function eur(n: number) {
  return money(n * 100, "EUR");
}

/**
 * The headline's proof, played once on load: goods set off from Yogyakarta to Berlin, shipping,
 * duty and fees are added to each quote, the best delivered offer wins, and PayPal pays it out
 * step by step. The finished picture carries the whole story on its own, so nothing depends on
 * watching the animation. CSS only, so it stays smooth while the page hydrates.
 */
function BidStory() {
  return (
    <figure className="grid max-w-[600px]">
      <figcaption className="sr-only">
        Example tender. Bid A quoted lowest at {eur(2250)}, but costs {eur(3050)} delivered, over the {eur(BUDGET)} budget. Bids B and C are flagged as
        coordinated. Bid D, from Sari&apos;s workshop, costs {eur(2880)} delivered, {eur(170)} less than bid A. PayPal holds {eur(2540)} for goods and
        shipping and pays it in three steps.
      </figcaption>

      {/* Who is trading, and where the goods go. */}
      <div className="mb-5 flex items-center gap-3" aria-hidden="true">
        <Person id="seller-sari" name="Sari" place="Yogyakarta" />
        <div className="relative h-5 min-w-0 flex-1">
          <span className="route-line absolute inset-x-0 top-1/2 border-t border-dashed border-white/40" />
          <span className="route-parcel absolute inset-0">
            <span className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sun shadow-[0_0_0_4px_rgb(227_167_47/0.25)]" />
          </span>
        </div>
        <Person id="buyer-anna" name="Anna" place="Berlin" alignEnd />
      </div>

      {/* The comparison: quoted and delivered stay side by side, so the reversal is readable at any moment. */}
      <div className="auth-glass relative rounded-2xl p-4" aria-hidden="true">
        <span className="story-saved absolute -top-3 right-4 rounded-full bg-sun px-3 py-1 text-xs font-semibold text-[#141a4d]">
          {eur(170)} cheaper delivered than bid A
        </span>

        <p className="mb-2 text-xs text-white/70">Example tender, 300 batik napkins, 4 sealed bids</p>

        {/* Legend and column headings share one line. */}
        <div className={`${ROW} mb-1.5 text-[11px] text-white/70`}>
          <ul className="col-span-2 flex items-center gap-3 whitespace-nowrap">
            <li className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-white/90" />
              Quote
            </li>
            <li className="story-in flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-sun" />
              Shipping, duty, fees
            </li>
            <li className="story-in flex items-center gap-1.5">
              <span className="h-3 border-l-[1.5px] border-dashed border-white/60" />
              Budget {eur(BUDGET)}
            </li>
          </ul>
          <span className="text-right">Quoted</span>
          <span className="story-in text-right">Delivered</span>
        </div>

        <div className="grid gap-2">
          {BIDS.map((b, i) => {
            const win = b.letter === "D";
            return (
              <div key={b.letter} className={`relative text-sm ${ROW}`}>
                {win && <span className="story-win absolute -inset-x-2 -inset-y-1 rounded-md" />}
                <span className="relative flex min-w-0 items-baseline gap-1.5">
                  <span className={`text-xs font-semibold ${win ? "text-sun" : "text-white"}`}>{b.letter}</span>
                  <span className={`whitespace-nowrap text-[11px] ${win ? "text-sun" : "text-white/70"}`}>{b.note}</span>
                </span>
                <div className="relative h-2.5 rounded-[4px] bg-white/10">
                  <div
                    className="story-bar flex h-full gap-px"
                    style={
                      {
                        width: `${(b.delivered / SCALE) * 100}%`,
                        "--gap": `${100 - (b.quoted / b.delivered) * 100}%`,
                        "--i": i,
                      } as CSSProperties
                    }
                  >
                    <span className="h-full bg-white/90" style={{ width: `${(b.quoted / b.delivered) * 100}%` }} />
                    <span className="h-full flex-1 bg-sun" />
                  </div>
                  <span className="story-in pointer-events-none absolute -inset-y-1 border-l-[1.5px] border-dashed border-white/60" style={{ left: `${(BUDGET / SCALE) * 100}%` }} />
                </div>
                <span className="num relative text-right text-white/70">{eur(b.quoted)}</span>
                <span className={`num story-in relative text-right font-semibold ${win ? "text-sun" : "text-white"}`}>{eur(b.delivered)}</span>
              </div>
            );
          })}
        </div>

        <div className="story-end mt-3 grid gap-1 border-t border-white/10 pt-2.5 text-xs text-white/75">
          <p>AI reviewed every bid and asked sellers what was missing, on WhatsApp.</p>
          <p>⚑ B and C look coordinated. A person decides, the flag removes nobody.</p>
        </div>
      </div>

      {/* The money: held, then paid as the order moves. Overlaps the card above, so they read as one story. */}
      <div className="auth-glass story-hold relative z-10 -mt-2 ml-8 rounded-2xl p-3.5 sm:ml-16" aria-hidden="true">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-sm font-medium">{eur(2540)} held by PayPal for goods and shipping</span>
          <span className="text-xs text-white/70">Paid to Sari step by step</span>
        </div>
        <ol className="mt-2.5 flex gap-1.5">
          {MILESTONES.map((m, i) => (
            <li key={m.name} className="grid min-w-0 gap-1" style={{ flexGrow: m.pct, flexBasis: 0 }}>
              <span className="relative block h-1.5 overflow-hidden rounded-full bg-white/10">
                <span className="story-step absolute inset-0 origin-left rounded-full bg-sun" style={order(i)} />
              </span>
              <span className="truncate text-[11px] text-white/70">{m.name}</span>
              <span className="num -mt-1 text-xs font-medium text-white">{eur(m.amount)}</span>
            </li>
          ))}
        </ol>
      </div>
    </figure>
  );
}

function Person({ id, name, place, alignEnd = false }: { id: string; name: string; place: string; alignEnd?: boolean }) {
  return (
    <span className={`flex shrink-0 items-center gap-2.5 ${alignEnd ? "flex-row-reverse text-right" : ""}`}>
      <Avatar id={id} size={34} />
      <span className="grid leading-tight">
        <span className="text-sm font-medium">{name}</span>
        <span className="text-xs text-white/70">{place}</span>
      </span>
    </span>
  );
}
