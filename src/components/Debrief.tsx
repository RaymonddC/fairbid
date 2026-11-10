// Why a losing bid lost: shown to that seller after the award, and to the buyer as
// "what the other sellers see". The numbers come from src/lib/debrief.ts.

import type { Debrief as DebriefData } from "@/lib/debrief";
import { countryName, moneyFor } from "@/lib/format";
import { criterionKind } from "@/lib/scoring";

export type Lang = "en" | "id";

/** A criterion's name as it reads in a sentence. The buyer writes them in English. */
export function criterionName(name: string, lang: Lang): string {
  if (lang === "en") return name.toLowerCase();
  const kind = criterionKind(name);
  if (kind === "cost") return "biaya sampai tujuan";
  if (kind === "lead_time") return "waktu pengiriman";
  if (kind === "completeness") return "kelengkapan";
  return /handmade/i.test(name) ? "bukti buatan tangan" : name.toLowerCase();
}

const label = (name: string, lang: Lang) => {
  const n = lang === "en" ? name : criterionName(name, lang);
  return n.charAt(0).toUpperCase() + n.slice(1);
};

const copy = {
  en: {
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
    note: "Scored blind, on the same numbers the buyer saw. The winning bid's price lines and product details stay private.",
  },
  id: {
    title: "Anda tidak memenangkan tender ini",
    rank: "Peringkat Anda",
    of: (n: number) => `dari ${n}`,
    yourCost: "Total sampai tujuan Anda",
    winCost: (country: string) => `Penawaran pemenang, dari ${country}`,
    less: (x: string) => `${x} lebih murah dari Anda, sampai tujuan`,
    more: (x: string) => `${x} lebih mahal dari Anda, sampai tujuan`,
    criterion: "Kriteria",
    you: "Anda",
    winner: "Pemenang",
    behind: "Selisih poin",
    behindShort: "Selisih",
    note: "Dinilai tanpa nama, dari angka yang sama yang dilihat pembeli. Rincian harga dan produk pemenang tetap rahasia.",
  },
};

const ordinalId = (n: number) => `ke-${n}`;

/** The plain-words reasons. English is the debrief's own summary; Bahasa is built from the same numbers. */
function sentences(d: DebriefData, lang: Lang): string[] {
  if (lang === "en") return [d.summary];
  const eur = moneyFor(d.currency);
  const names = (list: string[]) => list.map((n) => criterionName(n, "id")).join(" dan ");
  const out = [`Penawaran Anda peringkat ${ordinalId(d.rank)} dari ${d.of} dengan ${d.myTotal} poin; penawaran pemenang ${d.winnerTotal} poin.`];
  if (d.overBudget) {
    out.push(`Total sampai tujuan Anda, ${eur(d.myDeliveredCents)}, melebihi anggaran pembeli ${eur(d.budgetCents)}, jadi berada di bawah semua penawaran yang masuk anggaran.`);
  }
  if (d.lostOn.length) out.push(`Nilai Anda paling tertinggal di ${names(d.lostOn)}.`);
  if (d.beatOn.length) out.push(`Anda lebih unggul dari pemenang di ${names(d.beatOn)}.`);
  if (d.winnerRank !== 1) out.push(`Pembeli memilih penawaran peringkat ${ordinalId(d.winnerRank)}: FairBid mengurutkan, pembeli yang memutuskan.`);
  return out;
}

export function Debrief({ d, lang = "en", heading = true }: { d: DebriefData; lang?: Lang; heading?: boolean }) {
  const c = copy[lang];
  const eur = moneyFor(d.currency);
  const gap = d.myDeliveredCents - d.winnerDeliveredCents;
  return (
    <div className="grid gap-4">
      {heading && <h2 className="text-lg">{c.title}</h2>}
      <div className="grid gap-1.5 text-sm">
        {sentences(d, lang).map((s) => (
          <p key={s}>{s}</p>
        ))}
      </div>

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
                  <span className="font-medium">{label(l.name, lang)}</span> <span className="text-xs text-muted">{l.weightPct}%</span>
                  <span className="block text-xs text-muted" lang="en">
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
