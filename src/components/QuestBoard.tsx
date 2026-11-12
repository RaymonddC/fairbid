"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { countryName, day, money } from "@/lib/format";
import { Pill } from "./ui";

export type QuestState = "open" | "sealed" | "review" | "won" | "lost" | "closed";

export interface Quest {
  id: string;
  title: string;
  needText: string;
  item: string;
  quantity: number;
  deliverTo: string;
  country: string;
  currency: string;
  budgetCents: number;
  closesAt: string;
  /** Hours until bidding closes, counted on the server; negative once closed. */
  closesInHours: number;
  deliveryDays: number;
  /** Only the count: sealed bids never leave the server. */
  bidCount: number;
  criteria: { name: string; weightPct: number }[];
  photo: string | null;
  state: QuestState;
  /** Why this seller was not chosen, once the tender is awarded. */
  reason: string | null;
}

type Filter = "all" | "open" | "mine" | "won";
type Sort = "closing" | "budget" | "newest";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open for bids" },
  { key: "mine", label: "My bids" },
  { key: "won", label: "Won" },
];

/** The seller's board of tenders ("quests"): search, filter and sort, then open one to bid. */
export function QuestBoard({ quests }: { quests: Quest[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [country, setCountry] = useState("all");
  const [sort, setSort] = useState<Sort>("closing");

  const countries = useMemo(() => [...new Set(quests.map((x) => x.country))], [quests]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return quests
      .filter((x) => !term || `${x.title} ${x.item} ${x.needText}`.toLowerCase().includes(term))
      .filter((x) => country === "all" || x.country === country)
      .filter((x) =>
        filter === "open" ? x.state === "open" : filter === "mine" ? x.state !== "open" && x.state !== "closed" : filter === "won" ? x.state === "won" : true,
      )
      .sort((a, b) =>
        sort === "budget"
          ? b.budgetCents - a.budgetCents
          : sort === "newest"
            ? b.closesAt.localeCompare(a.closesAt)
            : // Closing soon: open ones first, soonest deadline first.
              Number(a.closesInHours < 0) - Number(b.closesInHours < 0) || a.closesInHours - b.closesInHours,
      );
  }, [quests, q, filter, country, sort]);

  const count = (f: Filter) =>
    quests.filter((x) => (f === "open" ? x.state === "open" : f === "mine" ? x.state !== "open" && x.state !== "closed" : f === "won" ? x.state === "won" : true)).length;

  return (
    <section className="grid gap-4" aria-labelledby="board-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="board-title" className="text-base">
          Every tender you can see
        </h2>
        <p className="text-xs text-muted" aria-live="polite">
          {shown.length} of {quests.length} tenders
        </p>
      </div>

      <div className="grid gap-3 rounded-xl bg-surface p-3 ring-1 ring-line sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="relative">
          <span className="sr-only">Search tenders</span>
          <SearchIcon />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Napkins, ceramics, rattan…"
            className="min-h-10 w-full rounded-lg border border-line-strong bg-canvas pl-9 pr-3 text-sm outline-none focus:border-dye focus:ring-2 focus:ring-dye/15"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          <span className="whitespace-nowrap">Ships to</span>
          <select value={country} onChange={(e) => setCountry(e.target.value)} className="min-h-10 rounded-lg border border-line-strong bg-canvas px-2 text-sm text-ink">
            <option value="all">Anywhere</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {countryName(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          <span className="whitespace-nowrap">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="min-h-10 rounded-lg border border-line-strong bg-canvas px-2 text-sm text-ink">
            <option value="closing">Closing soon</option>
            <option value="budget">Highest budget</option>
            <option value="newest">Newest</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-1.5 sm:col-span-3" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm transition-colors ${
                filter === f.key ? "bg-dye text-canvas" : "bg-canvas text-muted ring-1 ring-inset ring-line hover:text-ink"
              }`}
            >
              {f.label}
              <span className={`num text-xs ${filter === f.key ? "text-canvas/80" : "text-faint"}`}>{count(f.key)}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="grid justify-items-center gap-1 rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
          <p className="text-sm font-medium">No tenders match</p>
          <p className="text-sm text-muted">Clear the search or pick another filter.</p>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {shown.map((x) => (
            <li key={x.id}>
              <QuestCard q={x} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function QuestCard({ q }: { q: Quest }) {
  const open = q.state === "open" || q.state === "sealed";
  const urgent = q.closesInHours >= 0 && q.closesInHours <= 48;
  return (
    <Link
      href={`/tender/${q.id}`}
      className={`notice group grid h-full content-between gap-4 rounded-xl p-4 transition-colors hover:border-line-strong ${q.state === "won" ? "accent-edge" : ""}`}
    >
      <div className="grid gap-3">
        <div className="flex items-start gap-3">
          {/* Only a real photo gets a tile: an empty square reads as broken. */}
          {q.photo && (
            <span className="h-14 w-14 shrink-0 overflow-hidden rounded-[3px] ring-1 ring-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={q.photo} alt="" className="h-full w-full object-cover" />
            </span>
          )}
          <div className="grid min-w-0 flex-1 gap-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatePill state={q.state} />
              {open && (
                <span className={`text-xs ${urgent ? "font-medium text-flag" : "text-muted"}`}>{closesIn(q.closesInHours)}</span>
              )}
            </div>
            <h3 className="truncate text-[15px] group-hover:text-dye">{q.title}</h3>
            <p className="text-xs text-muted">
              {q.quantity.toLocaleString("en")} × {q.item}, to {q.deliverTo.split(",")[0]}, {countryName(q.country)}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-2 rounded-lg bg-canvas p-2.5 text-sm">
          <div className="grid gap-0.5">
            <dt className="text-xs text-muted">Budget</dt>
            <dd className="num font-semibold">{money(q.budgetCents, q.currency)}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-xs text-muted">Deliver in</dt>
            <dd className="num font-semibold">{q.deliveryDays} days</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-xs text-muted">Sealed bids</dt>
            <dd className="num font-semibold">{q.bidCount}</dd>
          </div>
        </dl>

        {/* The criteria as one line of text, not a row of pills. */}
        <p className="text-xs text-muted">
          Scored on {q.criteria.map((c) => `${c.name.toLowerCase()} ${c.weightPct}%`).join(", ")}
        </p>

        {q.reason && <p className="rounded-lg bg-canvas p-3 text-sm text-muted">{q.reason}</p>}
      </div>

      <span className="flex items-center justify-between gap-3 border-t border-line pt-3 text-sm">
        <span className="text-xs text-faint">{q.closesInHours >= 0 ? `Closes ${day(q.closesAt)}` : `Closed ${day(q.closesAt)}`}</span>
        <span className="font-medium text-dye">
          {q.state === "open" ? "Bid now" : q.state === "sealed" ? "Edit your bid" : q.state === "won" ? "See your payments" : "View tender"}
        </span>
      </span>
    </Link>
  );
}

function StatePill({ state }: { state: QuestState }) {
  switch (state) {
    case "open":
      return (
        <Pill tone="warn" dot>
          Open for bids
        </Pill>
      );
    case "sealed":
      return (
        <Pill tone="dye" dot>
          Your bid is sealed
        </Pill>
      );
    case "review":
      return (
        <Pill tone="warn" dot>
          Being reviewed
        </Pill>
      );
    case "won":
      return <Pill tone="ok">You won</Pill>;
    case "lost":
      return <Pill>Not chosen</Pill>;
    case "closed":
      return <Pill>Closed</Pill>;
  }
}

function closesIn(hours: number) {
  if (hours < 1) return "Closes within the hour";
  if (hours < 48) return `Closes in ${Math.round(hours)} hours`;
  return `Closes in ${Math.round(hours / 24)} days`;
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" strokeLinecap="round" />
    </svg>
  );
}
