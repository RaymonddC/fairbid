"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { scoreAction } from "@/app/actions";
import { moneyFor } from "@/lib/format";
import { atLeast, rankBids, type TenderView } from "@/lib/views";
import { ActionButton } from "./ActionButton";
import { BidGrid, StatusChips, scoreRows } from "./BidGrid";
import { CostBars } from "./CostBars";
import { Button, Panel, Pill, SectionTitle, linkButton } from "./ui";

export function Compare({ t }: { t: TenderView }) {
  const eur = moneyFor(t.currency);
  // No import VAT at the destination (the US): the VAT switch has nothing to change.
  const hasVat = t.bids.some((b) => b.vatCents > 0);
  const [delivered, setDelivered] = useState(atLeast(t.status, "AWARDED"));
  const [reclaimVat, setReclaimVat] = useState(t.vatReclaimable);

  if (t.sealed) {
    return (
      <Panel className="grid justify-items-start gap-2">
        <h2 className="text-base">Bids are still sealed</h2>
        <p className="text-sm text-muted">You can compare once bidding closes.</p>
        <Link href={`/tender/${t.id}`} className="text-sm font-medium text-dye underline underline-offset-4">
          Go to sealed bids
        </Link>
      </Panel>
    );
  }

  if (!atLeast(t.status, "SCORED")) {
    return (
      <Panel className="grid justify-items-start gap-3">
        <h2 className="text-base">Score the bids first</h2>
        <p className="max-w-[60ch] text-sm text-muted">
          Scoring prices every bid at delivered cost (goods, shipping, import duty, broker fees) and scores it against your published
          criteria, each with a written reason.
          {t.waitingReplies > 0 ? ` ${t.waitingReplies} replies are still waiting; you can score now.` : ""}
        </p>
        <p className="text-sm text-muted">
          Something unclear in a bid?{" "}
          <Link href={`/tender/${t.id}/review`} className="font-medium text-dye underline underline-offset-4">
            Ask the sellers first
          </Link>
          , so their answers count in the scores.
        </p>
        <ActionButton
          action={() => scoreAction(t.id)}
          busy="Pricing and scoring…"
          success={["Bids scored", "Every bid is priced at delivered cost, with a reason for each score."]}
        >
          Score the bids
        </ActionButton>
      </Panel>
    );
  }

  const ranked = rankBids(t.bids);
  const top = ranked[0];
  const winnerId = t.award?.bidId ?? null;
  const total = (b: (typeof t.bids)[number]) => (reclaimVat ? b.deliveredCents : b.deliveredGrossCents);
  const cheapestQuote = [...t.bids].sort((a, b) => a.goodsCents - b.goodsCents)[0];
  const saving = total(cheapestQuote) - total(top);
  const revealed = delivered || !!winnerId;
  const flag = t.flags[0];
  const weights = t.criteria.map((c) => `${c.name.toLowerCase()} ${c.weightPct}%`).join(", ");

  return (
    <div className="grid gap-8">
      {/* The one bold moment of the app: quoted price versus what each bid really costs. */}
      <Panel className="grid gap-5 p-0">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
          <div className="grid gap-1">
            <h2 className="text-xl">{delivered ? `What each bid really costs in ${t.spec.deliverTo.split(",")[0] || "Berlin"}` : "What sellers quoted"}</h2>
            <p className="max-w-[60ch] text-sm text-muted">
              {delivered
                ? `Goods, shipping, import duty and broker fees${reclaimVat ? "" : ", plus import VAT"}. The dashed line is your ${eur(t.budgetCents)} budget.`
                : "Quoted prices leave out shipping, duty and fees. Switch to delivered cost to see the real total."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative grid grid-cols-2 rounded-lg bg-canvas p-1 text-sm ring-1 ring-inset ring-line" role="group" aria-label="Price view">
              <span
                className={`absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-md bg-surface shadow-[0_1px_2px_rgba(21,26,45,0.12),0_0_0_1px_rgba(21,26,45,0.06)] transition-transform duration-300 ease-out ${
                  delivered ? "translate-x-full" : ""
                }`}
                aria-hidden="true"
              />
              <button
                onClick={() => setDelivered(false)}
                aria-pressed={!delivered}
                className={`relative min-h-10 rounded-md px-4 font-medium transition-colors ${!delivered ? "text-ink" : "text-muted hover:text-ink"}`}
              >
                Quoted price
              </button>
              <button
                onClick={() => setDelivered(true)}
                aria-pressed={delivered}
                className={`relative min-h-10 rounded-md px-4 font-medium transition-colors ${delivered ? "text-ink" : "text-muted hover:text-ink"}`}
              >
                Delivered cost
              </button>
            </div>
            {hasVat && <label htmlFor="reclaim-vat" className={`flex min-h-11 items-center gap-2 px-1 text-sm ${delivered ? "cursor-pointer" : "cursor-not-allowed opacity-40"}`}>
              <input
                id="reclaim-vat"
                type="checkbox"
                checked={reclaimVat}
                disabled={!delivered}
                onChange={(e) => setReclaimVat(e.target.checked)}
                className="h-4 w-4 accent-[var(--dye)]"
              />
              I can reclaim VAT
            </label>}
          </div>
        </div>

        <div className="px-5">
          <CostBars bids={t.bids} budgetCents={t.budgetCents} delivered={delivered} withVat={!reclaimVat} currency={t.currency} />
        </div>

        {delivered && (
          <div className="grid border-t border-line sm:grid-cols-3 sm:divide-x sm:divide-line">
            {cheapestQuote.overBudget ? (
              <Callout tone="flag" title={`Bid ${cheapestQuote.letter} is over budget`}>
                The lowest quote, {eur(cheapestQuote.goodsCents)}, lands at {eur(total(cheapestQuote))}.
              </Callout>
            ) : (
              <Callout tone="ok" title="Every bid fits the budget">
                The lowest quote lands at {eur(total(cheapestQuote))} delivered.
              </Callout>
            )}
            {flag ? (
              <Callout tone="warn" title={`Bids ${flag.letters.join(" and ")} look coordinated`}>
                {flag.evidence[0]}.{" "}
                <a href="#flag-evidence" className="font-medium text-ink underline underline-offset-2">
                  See the evidence
                </a>
              </Callout>
            ) : (
              <Callout tone="ok" title="No coordinated bids">
                No pair of bids matched on price, costs and wording.
              </Callout>
            )}
            <Callout tone="ok" title={`Bid ${top.letter} is the best delivered offer`}>
              {saving > 0 && <span className="num block text-2xl font-semibold text-ink">{eur(saving)} saved</span>}
              Against the lowest quote, delivered{!hasVat ? "" : reclaimVat ? ", VAT reclaimed" : ", VAT included"}.
            </Callout>
          </div>
        )}
      </Panel>

      <section className="grid content-start gap-3" aria-labelledby="scores-title">
        <SectionTitle id="scores-title" aside={`Weights: ${weights}`}>
          Blind scores
        </SectionTitle>
        {!revealed && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-line-strong px-4 py-3 text-sm">
            <span className="text-muted">Delivered totals, scores and flags appear when you switch to delivered cost.</span>
            <Button variant="secondary" onClick={() => setDelivered(true)}>
              Show delivered cost
            </Button>
          </div>
        )}
        <BidGrid bids={t.bids} criteria={t.criteria} withVat={!reclaimVat} revealed={revealed} winnerId={winnerId} currency={t.currency} />
        {revealed && <ScoreReasons t={t} withVat={!reclaimVat} winnerId={winnerId} />}
      </section>

      {revealed && (
        <div className="grid gap-6 md:grid-cols-2">
          {flag ? (
            <Panel className="grid content-start gap-3">
              <h3 id="flag-evidence" className="scroll-mt-24 text-base">
                Why bids {flag.letters.join(" and ")} are flagged
              </h3>
              <ul className="grid gap-1.5 text-sm">
                {flag.evidence.map((e) => (
                  <li key={e} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden="true" />
                    {e}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">A flag never removes a bid. You decide.</p>
            </Panel>
          ) : (
            <div />
          )}

          <Panel className="grid content-start gap-3" featured>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base">{winnerId ? `Awarded: bid ${t.award!.letter}` : `Recommended: bid ${top.letter}`}</h3>
              <Pill tone="ok">
                <span className="num">{(top.total ?? 0).toFixed(1)}</span> / 100
              </Pill>
            </div>
            <p className="text-sm text-muted">
              Highest score inside the budget. PayPal will hold {eur(top.holdCents)} for the seller (goods and shipping) until delivery; you
              pay the {eur(top.dutyCents)} import duty{hasVat ? ", import VAT" : ""} and broker fees at the border.
            </p>
            <Link href={`/tender/${t.id}/award${winnerId ? "" : `?bid=${top.id}`}`} className={linkButton.primary}>
              {winnerId ? "Go to payments" : `Award to bid ${top.letter}`}
            </Link>
          </Panel>
        </div>
      )}
    </div>
  );
}

/** Every score has a written reason. One expandable row per bid. */
function ScoreReasons({ t, withVat, winnerId }: { t: TenderView; withVat: boolean; winnerId: string | null }) {
  const rows = scoreRows(t.bids, withVat, winnerId);
  return (
    <div className="grid gap-2 pt-2">
      <h3 className="text-sm">Why each score</h3>
      <ul className="notice divide-y divide-line overflow-hidden rounded-xl">
        {rows.map((r) => (
          <li key={r.id}>
            <details className="group open:bg-canvas/60">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-canvas">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">Bid {r.letter}</span>
                  <span className="num text-muted">{r.score.toFixed(1)} / 100</span>
                  <StatusChips statuses={r.statuses} />
                </span>
                <span className="text-faint transition-transform group-open:rotate-180" aria-hidden="true">
                  ▾
                </span>
              </summary>
              <dl className="grid gap-x-4 gap-y-2 px-4 pb-4 text-sm sm:grid-cols-[190px_1fr]">
                {t.criteria.map((c) => {
                  const s = r.scores.find((x) => x.criterionId === c.id);
                  return (
                    <div key={c.id} className="contents">
                      <dt className="text-muted">
                        {c.name} ({c.weightPct}%)
                      </dt>
                      <dd>
                        <span className="num">{s?.score ?? "–"}</span>. {s?.reason}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Callout({ tone, title, children }: { tone: "ok" | "warn" | "flag"; title: string; children: ReactNode }) {
  const look = { ok: "text-ok", warn: "text-warn", flag: "text-flag" }[tone];
  const dot = { ok: "bg-ok", warn: "bg-warn", flag: "bg-flag" }[tone];
  return (
    <div className="fade-in grid content-start gap-1 border-t border-line p-5 first:border-t-0 sm:border-t-0">
      <span className={`flex items-center gap-2 text-sm font-semibold ${look}`}>
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
        {title}
      </span>
      <span className="text-sm text-muted">{children}</span>
    </div>
  );
}
