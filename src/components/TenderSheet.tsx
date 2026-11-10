"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { money } from "@/lib/format";

// The demo tender's own figures, in euros (prisma/seed-data.ts). Duty at the demo rate.
const BIDS = [
  { letter: "A", who: "Lowest quote", quote: 2250, shipping: 420, duty: 270, fees: 110, delivered: 3050 },
  { letter: "D", who: "Sari's workshop, Yogyakarta", quote: 2290, shipping: 250, duty: 275, fees: 65, delivered: 2880 },
];
const BUDGET = 3000;
const SCALE = 3250;

const eur = (n: number) => money(n * 100, "EUR");

/**
 * The headline's proof as the paper it would really be: a tender sheet where each sealed quote
 * is opened, shipping, duty and fees are added, and the best delivered offer is stamped. Played
 * once on load; the finished sheet says everything on its own. It lies on the desk in 3D, on top
 * of the other sealed bids, and the stack leans toward the pointer.
 */
export function TenderSheet() {
  const stack = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stack.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const x = e.clientX / window.innerWidth - 0.5;
        const y = e.clientY / window.innerHeight - 0.5;
        el.style.setProperty("--tilt-x", `${(-y * 10).toFixed(2)}deg`);
        el.style.setProperty("--tilt-y", `${(x * 14).toFixed(2)}deg`);
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
    };
  }, []);

  return (
    <div className="tender-desk">
      <div ref={stack} className="tender-stack relative">
      {/* The other sealed bids, under the sheet on top. */}
      <span className="tender-under" aria-hidden="true" />
      <span className="tender-under" aria-hidden="true" />
      <span className="tender-under" aria-hidden="true" />
      <figure className="tender-sheet relative grid gap-4 rounded-[3px] px-6 pb-5 pt-5 text-[var(--paper-ink)]">
        <figcaption className="sr-only">
          Example tender for 300 handmade batik napkins, budget {eur(BUDGET)}. Bid A quoted lowest at {eur(2250)}, but costs {eur(3050)} delivered,
          over budget. Sari&apos;s bid D quoted {eur(2290)} and costs {eur(2880)} delivered: the best delivered offer.
        </figcaption>

        <header className="grid gap-1 border-b border-[var(--paper-line)] pb-3" aria-hidden="true">
          <div className="flex items-baseline justify-between gap-3 text-[12px] text-[var(--paper-muted)]">
            <span>Demo tender</span>
            <span>4 sealed bids, opened at close</span>
          </div>
          <p className="font-display text-[22px] font-semibold leading-tight tracking-[-0.01em]">300 handmade batik napkins</p>
          <p className="text-[13px] text-[var(--paper-muted)]">
            Delivered to Berlin. Budget <span className="num font-medium text-[var(--paper-ink)]">{eur(BUDGET)}</span>
          </p>
        </header>

        <div className="grid gap-4" aria-hidden="true">
          {BIDS.map((b, i) => {
            const over = b.delivered > BUDGET;
            return (
              <div key={b.letter} className="relative grid gap-1.5" style={{ "--i": i } as CSSProperties}>
                <div className="flex items-baseline gap-2 text-[13px]">
                  <span className="font-semibold">{b.letter}</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--paper-muted)]">{b.who}</span>
                  <span className="num text-[var(--paper-muted)]">quote {eur(b.quote)}</span>
                  <span className="sheet-total num w-[76px] text-right text-[15px] font-semibold">{eur(b.delivered)}</span>
                </div>

                <span className="relative block h-2 rounded-[3px] bg-[var(--paper-line)]">
                  <span
                    className="story-bar flex h-full gap-px"
                    style={
                      {
                        width: `${(b.delivered / SCALE) * 100}%`,
                        "--gap": `${100 - (b.quote / b.delivered) * 100}%`,
                        "--i": i,
                      } as CSSProperties
                    }
                  >
                    <span className="h-full bg-[var(--paper-ink)]" style={{ width: `${(b.quote / b.delivered) * 100}%` }} />
                    <span className="h-full flex-1 bg-duty" />
                  </span>
                  <span className="story-in absolute -inset-y-1 border-l-[1.5px] border-dashed border-[var(--paper-ink)]/60" style={{ left: `${(BUDGET / SCALE) * 100}%` }} />
                </span>

                <p className="sheet-fill num flex flex-wrap gap-x-2.5 text-[12.5px] text-[var(--paper-muted)]">
                  <span>+ shipping {eur(b.shipping)}</span>
                  <span>+ duty {eur(b.duty)}</span>
                  <span>+ fees {eur(b.fees)}</span>
                  {over && <span className="sheet-over font-medium text-[var(--paper-flag)]">Over budget</span>}
                </p>

                {!over && (
                  <span className="sheet-stamp absolute -bottom-2.5 right-1 rounded-[4px] border-2 border-double border-[var(--stamp)] px-2 py-0.5 text-[12px] font-semibold text-[var(--stamp)]">
                    Best delivered
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <footer className="flex items-baseline justify-between gap-3 border-t border-[var(--paper-line)] pt-3 text-[12.5px] text-[var(--paper-muted)]" aria-hidden="true">
          <span>
            <span className="inline-block h-2 w-2 rounded-[2px] bg-[var(--paper-ink)] align-middle" /> Quote{" "}
            <span className="ml-2 inline-block h-2 w-2 rounded-[2px] bg-duty align-middle" /> Shipping, duty, fees
          </span>
          <span>PayPal pays Sari as the order moves</span>
        </footer>
      </figure>
      </div>
    </div>
  );
}
