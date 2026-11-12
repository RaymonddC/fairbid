// Why a losing bid lost: shown to that seller after the award, and to the buyer as
// "what the other bidders see". The numbers come from src/lib/debrief.ts.

import type { Debrief as DebriefData } from "@/lib/debrief";
import { countryName, moneyFor } from "@/lib/format";

const label = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

const c = {
    title: "You did not win this tender",
    rank: "Your rank",
    of: (n: number) => `of ${n}`,
    yourCost: "Your delivered cost",
    winCost: (country: string) => `Winning bid, from ${country}`,
    less: (x: string) => `${x} less than yours, delivered`,
    more: (x: string) => `${x} more than yours, delivered`,
    criterion: "Criterion",
    you: "You",
    winner: "Winner",
    behind: "Points behind",
    behindShort: "Points",
    note: "Scored blind, on the same numbers the tender owner saw. The winning bid's price lines and product details stay private.",
};

export function Debrief({ d, heading = true }: { d: DebriefData; heading?: boolean }) {
  const eur = moneyFor(d.currency);
  const gap = d.myDeliveredCents - d.winnerDeliveredCents;
  return (
    <div className="grid gap-4">
      {heading && <h2 className="text-lg">{c.title}</h2>}
      <p className="text-sm">{d.summary}</p>

      <dl className="grid overflow-hidden rounded-lg ring-1 ring-line sm:grid-cols-3 sm:divide-x sm:divide-line">
        <div className="grid gap-0.5 border-b border-line p-3 sm:border-b-0">
          <dt className="text-xs text-muted">{c.rank}</dt>
          <dd className="num text-xl font-semibold">
            {d.rank} <span className="text-sm font-normal text-muted">{c.of(d.of)}</span>
          </dd>
        </div>
        <div className="grid gap-0.5 border-b border-line p-3 sm:border-b-0">
          <dt className="text-xs text-muted">{c.yourCost}</dt>
          <dd className={`num text-xl font-semibold ${d.overBudget ? "text-flag" : ""}`}>{eur(d.myDeliveredCents)}</dd>
        </div>
        <div className="grid gap-0.5 p-3">
          <dt className="text-xs text-muted">{c.winCost(countryName(d.winnerCountry))}</dt>
          <dd className="num text-xl font-semibold">
            {eur(d.winnerDeliveredCents)}
          </dd>
          {gap !== 0 && <dd className="text-xs text-muted">{gap > 0 ? c.less(eur(gap)) : c.more(eur(-gap))}</dd>}
        </div>
      </dl>

      <div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">{c.criterion}</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">{c.you}</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">{c.winner}</th>
              <th scope="col" className="py-2 pl-2 text-right font-medium">
                <span className="hidden sm:inline">{c.behind}</span>
                <span className="sm:hidden">{c.behindShort}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.name} className="border-b border-line align-top last:border-b-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <span className="font-medium">{label(l.name)}</span> <span className="text-xs text-muted">{l.weightPct}%</span>
                  <span className="block text-xs text-muted">
                    {l.myReason}
                  </span>
                </th>
                <td className="num px-2 py-2 text-right">{l.myScore}</td>
                <td className="num px-2 py-2 text-right">{l.winnerScore}</td>
                <td className={`num py-2 pl-2 text-right font-medium ${l.pointsBehind > 0 ? "text-flag" : l.pointsBehind < 0 ? "text-ok" : "text-muted"}`}>
                  {l.pointsBehind > 0 ? `−${l.pointsBehind}` : l.pointsBehind < 0 ? `+${-l.pointsBehind}` : "0"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">{c.note}</p>
    </div>
  );
}
