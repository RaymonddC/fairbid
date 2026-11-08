"use client";

import { useState } from "react";
import { moneyFor } from "@/lib/format";
import type { MonthFlow } from "@/lib/cashflow";

const SERIES = [
  { key: "paidCents", label: "Paid to sellers", color: "bg-chart-1", stroke: "var(--chart-1)" },
  { key: "heldCents", label: "Held by PayPal at month end", color: "bg-chart-2", stroke: "var(--chart-2)" },
] as const;

/** Grouped bars per month, one money axis in a single currency. Hover or focus a month for its values; the
 * transactions table under the chart carries the same numbers without hovering. */
export function CashflowChart({ months, currency }: { months: MonthFlow[]; currency: string }) {
  const eur = moneyFor(currency);
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...months.flatMap((m) => [m.paidCents, m.heldCents]));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const pct = (v: number) => `${(v / top) * 100}%`;

  return (
    <figure className="grid gap-3">
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${s.color}`} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>

      {/* Top padding: the highest axis label is centred on the top gridline, so half of it sits above the plot. */}
      <div className="relative grid grid-cols-[52px_1fr] gap-2 pt-2">
        {/* Axis labels, recessive. */}
        <div className="relative h-48 text-right text-[11px] leading-none text-faint" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="num absolute right-0 -translate-y-1/2" style={{ bottom: pct(t) }}>
              {eur(t)}
            </span>
          ))}
        </div>
        <div className="relative h-48">
          {ticks.map((t) => (
            <span key={t} className="absolute inset-x-0 border-t border-line" style={{ bottom: pct(t) }} aria-hidden="true" />
          ))}
          <ol className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
            {months.map((m, i) => (
              <li key={m.month} className="relative">
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  aria-label={`${m.label}: paid ${eur(m.paidCents)}, held at month end ${eur(m.heldCents)}`}
                  className={`absolute inset-0 flex items-end justify-center gap-[2px] rounded-md px-[18%] ${active === i ? "bg-dye-soft/60" : ""}`}
                >
                  {SERIES.map((s) => (
                    <span
                      key={s.key}
                      className={`bar-seg w-full max-w-7 rounded-t-[4px] ${s.color} ${active !== null && active !== i ? "opacity-60" : ""}`}
                      style={{ height: pct(m[s.key]) }}
                    />
                  ))}
                </button>
                {active === i && (
                  <div
                    role="status"
                    className={`notice pointer-events-none absolute bottom-full z-10 mb-2 grid w-52 gap-1 rounded-lg p-2.5 text-xs shadow-lg ${
                      i > months.length / 2 ? "right-0" : "left-0"
                    }`}
                  >
                    <span className="font-medium text-ink">{m.label}</span>
                    {SERIES.map((s) => (
                      <span key={s.key} className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5 text-muted">
                          <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.stroke }} aria-hidden="true" />
                          {s.label}
                        </span>
                        <strong className="num text-ink">{eur(m[s.key])}</strong>
                      </span>
                    ))}
                    {m.releasedCents > 0 && (
                      <span className="flex justify-between gap-3 text-muted">
                        Released to you <strong className="num text-ink">{eur(m.releasedCents)}</strong>
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
        <span aria-hidden="true" />
        <ol className="grid text-center text-xs text-muted" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }} aria-hidden="true">
          {months.map((m) => (
            <li key={m.month}>{m.label}</li>
          ))}
        </ol>
      </div>
    </figure>
  );
}

/** A round axis step (1, 2 or 5 × 10ⁿ cents) giving three or four gridlines. */
function niceStep(max: number) {
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
