"use client";

import { countryName, moneyFor } from "@/lib/format";
import type { BidView } from "@/lib/views";

const segments = [
  { key: "goods", label: "Goods", className: "bg-dye" },
  { key: "shipping", label: "Shipping", className: "bg-dye/45" },
  { key: "duty", label: "Import duty", className: "bg-duty" },
  { key: "fees", label: "Broker fees", className: "bg-faint" },
  { key: "vat", label: "Import VAT", className: "vat-hatch" },
] as const;

type Key = (typeof segments)[number]["key"];

/** Stacked bars per bid: quoted price alone, or every cost to Berlin, against the budget line. */
export function CostBars({
  bids,
  budgetCents,
  delivered,
  withVat,
  currency,
}: {
  bids: BidView[];
  budgetCents: number;
  delivered: boolean;
  withVat: boolean;
  currency: string;
}) {
  const eur = moneyFor(currency);
  const totalOf = (b: BidView) => (delivered ? (withVat ? b.deliveredGrossCents : b.deliveredCents) : b.goodsCents);
  const rows = [...bids].sort((a, b) => totalOf(a) - totalOf(b));
  // Room for the largest bar plus a margin, so the budget line never sits at the edge.
  const scale = Math.max(budgetCents, ...bids.map((b) => b.deliveredGrossCents)) * 1.05;
  const pct = (n: number) => `${(n / scale) * 100}%`;

  const value = (b: BidView, key: Key) => {
    if (key === "goods") return b.goodsCents;
    if (!delivered) return 0;
    if (key === "shipping") return b.shippingCents;
    if (key === "duty") return b.dutyCents;
    if (key === "fees") return b.feesCents;
    return withVat ? b.vatCents : 0;
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 pt-6 sm:gap-3">
        {rows.map((b, i) => {
          const over = delivered && b.overBudget;
          return (
            <div key={b.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[88px_1fr_104px]">
              <div className="flex items-baseline gap-2 sm:grid sm:gap-0">
                <span className="text-sm font-semibold">Bid {b.letter}</span>
                <span className="text-xs text-muted">{countryName(b.country)}</span>
              </div>
              <div className="relative col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                <div className="flex h-7 overflow-hidden rounded bg-canvas" role="img" aria-label={`Bid ${b.letter}: ${eur(totalOf(b))}`}>
                  {segments.map((s) => (
                    <div
                      key={s.key}
                      className={`bar-seg h-full ${s.className}`}
                      style={{ width: pct(value(b, s.key)) }}
                      title={`${s.label} ${eur(value(b, s.key))}`}
                    />
                  ))}
                </div>
                <div
                  className="pointer-events-none absolute -inset-y-1 border-l-2 border-dashed border-ink/60"
                  style={{ left: pct(budgetCents) }}
                  aria-hidden="true"
                >
                  {i === 0 && (
                    <span className="num absolute -top-6 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[11px] font-medium text-canvas sm:inline">
                      Budget {eur(budgetCents)}
                    </span>
                  )}
                </div>
              </div>
              <div className="grid text-right sm:col-start-3 sm:row-start-1">
                <span className={`num font-semibold ${over ? "text-flag" : ""}`}>{eur(totalOf(b))}</span>
                {over && <span className="text-xs text-flag">over budget</span>}
              </div>
            </div>
          );
        })}
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-1 pb-1 text-xs text-muted sm:pl-[104px]" aria-label="Legend">
        {segments
          .filter((s) => delivered || s.key === "goods")
          .filter((s) => withVat || s.key !== "vat")
          .map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${s.className}`} />
              {s.label}
            </li>
          ))}
        <li className="flex items-center gap-1.5 sm:hidden">
          <span className="inline-block h-3 border-l-2 border-dashed border-ink/60" />
          Budget {eur(budgetCents)}
        </li>
      </ul>
    </div>
  );
}
