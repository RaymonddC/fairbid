import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { CashflowChart } from "@/components/CashflowChart";
import { QuestBoard, type Quest, type QuestState } from "@/components/QuestBoard";
import { AgentKeys } from "@/components/AgentKeys";
import { OwnAgent } from "@/components/OwnAgent";
import { agentActivity } from "@/lib/agents/own-agent";
import { ChannelLinker } from "@/components/ChannelLinker";
import { TransactionsGrid } from "@/components/TransactionsGrid";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Panel, SectionTitle, linkButton } from "@/components/ui";
import { buyerCashflow, sellerCashflow, type UpcomingPayment } from "@/lib/cashflow";
import { availableChannels, buyerChannels, buyerLinksOf, linksOf } from "@/lib/channels";
import { db } from "@/lib/db";
import { maskAddress } from "@/lib/channels/types";
import { day, money } from "@/lib/format";
import { listAgentKeys } from "@/lib/mcp/agent-keys";
import { publicBaseUrl } from "@/lib/public-url";
import { getUser } from "@/lib/session";
import { getTenderView } from "@/lib/tender-data";
import { rankBids, type TenderSummary } from "@/lib/views";

export const metadata = { title: "Dashboard · FairBid" };

export default async function Home() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user.role === "buyer" ? <BuyerHome buyerId={user.id} /> : <SellerHome sellerId={user.sellerId!} name={user.name} />;
}

// ── Buyer ────────────────────────────────────────────────────────────────────

async function BuyerHome({ buyerId }: { buyerId: string }) {
  const [cf, links] = await Promise.all([buyerCashflow(buyerId), buyerLinksOf(buyerId)]);
  const active = cf.tenders.filter((t) => t.status !== "COMPLETE" && t.status !== "CANCELLED");
  const done = cf.tenders.filter((t) => t.status === "COMPLETE");
  // One figure per currency in use, never added across currencies: "€3,380 + $500".
  const total = (key: "heldCents" | "paidCents" | "releasedCents" | "savedCents") => sumText(cf.totals.map((c) => [c[key], c.currency]));
  const any = (key: "heldCents" | "releasedCents") => cf.totals.some((c) => c[key] > 0);
  const charts = cf.totals.filter((c) => c.currency === "EUR" || c.months.some((m) => m.paidCents || m.heldCents));

  return (
    <>
      <PageHeader
        title="Your tenders"
        actions={
          <Link href="/post" className={linkButton.primary}>
            Post a tender
          </Link>
        }
      />
      <div className="grid gap-8">
        {/* The money, as one ruled ledger: no cards, no coloured dots. */}
        <dl className={LEDGER}>
          <Kpi label="Held by PayPal" value={total("heldCents")} note={any("heldCents") ? "In your account, reserved for the bidder" : "Nothing on hold"} />
          <Kpi label="Paid to bidders" value={total("paidCents")} note={any("releasedCents") ? `${total("releasedCents")} released, never charged` : "Only when you confirm a step"} />
          <Kpi label="Saved against lowest quotes" value={total("savedCents")} note="At delivered cost" />
          <Kpi label="Questions waiting" value={String(cf.waiting)} note={cf.waiting ? "On bidders to answer" : "None"} />
        </dl>

        {cf.upcoming.length > 0 && <UpcomingPanel items={cf.upcoming} buyer />}

        <section className="grid gap-3" aria-labelledby="active-title">
          <SectionTitle id="active-title">Active tenders</SectionTitle>
          {active.length === 0 ? (
            <p className="text-sm text-muted">
              None yet.{" "}
              <Link href="/post" className="font-medium text-dye underline underline-offset-4">
                Post a tender
              </Link>{" "}
              to get sealed bids.
            </p>
          ) : (
            <ul className="notice divide-y divide-line">
              {active.map((t) => (
                <li key={t.id}>
                  <TenderRow t={t} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {done.length > 0 && (
          <section className="grid gap-3" aria-labelledby="done-title">
            <SectionTitle id="done-title">Completed</SectionTitle>
            <ul className="notice divide-y divide-line">
              {done.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/tender/${t.id}/award`}
                    className="grid gap-x-4 gap-y-0.5 px-5 py-3 text-sm hover:bg-raised sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_100px_110px]"
                  >
                    <span className="font-medium">{t.title}</span>
                    <span className="text-muted">{t.winnerName}</span>
                    <span className="num sm:text-right">{money(t.paidCents, t.currency)}</span>
                    <span className="num text-ok sm:text-right">{money(t.savedCents, t.currency)} saved</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Detail on request: the chart and the full payment record. */}
        <More title="Cash flow, last four months">
          <p className="text-sm text-muted">Money leaves your account only when you confirm a step.</p>
          {charts.map((c) => (
            <div key={c.currency} className="grid gap-2">
              {charts.length > 1 && <h3 className="text-sm text-muted">In {c.currency}</h3>}
              <CashflowChart months={c.months} currency={c.currency} />
            </div>
          ))}
        </More>
        {cf.transactions.length > 0 && (
          <More title={`Every payment (${cf.transactions.length})`}>
            <TransactionsGrid txs={cf.transactions} title="Payments" showSeller />
          </More>
        )}

        <ChannelLinker
          audience="buyer"
          channels={buyerChannels().map((c) => {
            const l = links.find((x) => x.kind === c.kind);
            return { ...c, linked: l ? maskAddress(c.kind, l.address) : null };
          })}
        />
      </div>
    </>
  );
}

/** A section that stays folded until asked for, so the dashboard shows what needs doing first. */
function More({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="notice group">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 text-sm font-medium hover:bg-raised">
        {title}
        <span className="text-faint transition-transform group-open:rotate-180" aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className="grid gap-4 border-t border-line p-5">{children}</div>
    </details>
  );
}

function UpcomingPanel({ items, buyer }: { items: UpcomingPayment[]; buyer: boolean }) {
  return (
    <Panel className="grid content-start gap-3">
      <div className="grid gap-0.5">
        <h2 className="text-base">{buyer ? "Due next" : "Coming to you next"}</h2>
        <p className="text-sm text-muted">
          {buyer ? "Each one is paid from a PayPal hold when you confirm the step." : "Paid when the buyer confirms the step."}
        </p>
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">Nothing due. Payments appear here once a hold is in place.</p>
      ) : (
        <ul className="grid gap-2">
          {items.map((u) => (
            <li key={u.tenderId}>
              <Link href={buyer ? `/tender/${u.tenderId}/award` : `/tender/${u.tenderId}`} className="grid gap-1 rounded-lg bg-canvas p-3 text-sm hover:bg-dye-soft/50">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{u.milestone}</span>
                  <span className="num font-semibold">{money(u.plannedCents, u.currency)}</span>
                </span>
                <span className="text-xs text-muted">
                  {u.tenderTitle}, {buyer ? u.sellerName : "from the buyer"}
                </span>
                {u.needsHold && (
                  <span className="text-xs font-medium text-warn">
                    {buyer
                      ? `${u.needsHold.replacing ? "The hold lapsed. Place a new one" : `Place the phase ${u.needsHold.phase} hold`}: ${money(u.needsHold.amountCents, u.currency)}`
                      : `Waiting for the buyer to hold phase ${u.needsHold.phase} with PayPal`}
                  </span>
                )}
                {u.holdExpiresAt && (
                  <span className={`text-xs ${u.daysLeft !== null && u.daysLeft <= 5 ? "font-medium text-flag" : "text-faint"}`}>
                    Hold ends {day(u.holdExpiresAt)}
                    {u.daysLeft !== null ? `, ${u.daysLeft <= 0 ? "today" : `in ${u.daysLeft} day${u.daysLeft === 1 ? "" : "s"}`}` : ""}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** One active tender as a ruled line: what it is, where it stands, and its three numbers. */
function TenderRow({ t }: { t: TenderSummary }) {
  return (
    <Link
      href={`/tender/${t.id}`}
      className="group grid gap-x-6 gap-y-1.5 px-5 py-3.5 hover:bg-raised sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
    >
      <span className="grid min-w-0 gap-1">
        <span className="font-medium group-hover:text-dye">{t.title}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <StatusPill status={t.status} waiting={t.waitingReplies} heldCents={t.heldCents} />
          <span>Deliver by {day(t.deliverBy)}</span>
        </span>
      </span>
      <dl className="grid grid-cols-3 gap-5 text-sm sm:text-right">
        <Stat label="Budget" value={money(t.budgetCents, t.currency)} />
        <Stat label="Bids" value={String(t.bidCount)} />
        <Stat label={t.status === "OPEN" ? "Closes" : "Closed"} value={day(t.closesAt).slice(0, -5)} />
      </dl>
    </Link>
  );
}

// ── Seller ───────────────────────────────────────────────────────────────────

// Estimates only, shown as such: the fee matches what the sandbox charged on a EUR
// receipt (3.49% + €0.55), and the rupiah rate is an assumption, not a live quote.
const PAYPAL_FEE_PCT = 3.49;
const PAYPAL_FEE_FIXED_CENTS = 55;
const IDR_PER: Record<string, number> = { EUR: 17_500, USD: 16_200 };
const netOf = (cents: number, payments: number) =>
  Math.max(0, cents - Math.round((cents * PAYPAL_FEE_PCT) / 100) - payments * PAYPAL_FEE_FIXED_CENTS);
const idr = (rupiah: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(rupiah);

/** "€3,380 + $500", skipping zero amounts; "€0" when everything is zero. */
function sumText(parts: [number, string][]): string {
  const shown = parts.filter(([cents]) => cents !== 0);
  return shown.length ? shown.map(([cents, cur]) => money(cents, cur)).join(" + ") : money(0, parts[0]?.[1] ?? "EUR");
}

async function SellerHome({ sellerId, name }: { sellerId: string; name: string }) {
  const [cf, links, agentKeys, base, agent, activity, tenders] = await Promise.all([
    sellerCashflow(sellerId),
    linksOf(sellerId),
    listAgentKeys(sellerId),
    publicBaseUrl(),
    db.seller.findUnique({ where: { id: sellerId }, select: { agentBrief: true, agentOn: true } }),
    agentActivity(sellerId),
    db.tender.findMany({
      // Every published tender: open ones to bid on, and closed ones this seller bid on.
      where: { OR: [{ status: "OPEN" }, { bids: { some: { sellerId } } }] },
      orderBy: { closesAt: "asc" },
      include: {
        bids: { where: { sellerId }, select: { id: true } },
        award: { select: { bidId: true } },
        criteria: { orderBy: { weightPct: "desc" }, select: { name: true, weightPct: true } },
        _count: { select: { bids: true } },
      },
    }),
  ]);
  const quests = await Promise.all(tenders.map((t) => toQuest(t)));
  const received = Object.entries(cf.received);
  const rupiah = received.reduce((s, [cur, r]) => s + (netOf(r.cents, r.payments) / 100) * (IDR_PER[cur] ?? IDR_PER.EUR), 0);
  const dueText = sumText(cf.upcoming.map((u) => [u.plannedCents, u.currency]));
  const dueNext = cf.upcoming.length > 0;
  const open = quests.filter((q) => q.state === "open").length;

  return (
    <>
      <PageHeader
        title={`Welcome, ${name}`}
        description="Buyers compare every bid at the price delivered to their door, so an honest all-in price is the one that counts."
      />
      <div className="grid gap-8">
        <dl className={LEDGER}>
          <Kpi label="Received through PayPal" value={sumText(received.map(([cur, r]) => [r.cents, cur]))} note={`${cf.transactions.length} payments`} />
          <Kpi label="In rupiah, after PayPal fees" value={idr(rupiah)} note="Estimate, after PayPal fees" />
          <Kpi label="Due to you next" value={dueText} note={dueNext ? "When the tender owner confirms the step" : "Nothing due right now"} />
          <Kpi label="Waiting for your bid" value={String(open)} note={open ? "Open tenders you have not bid on" : "You have bid on every open tender"} />
        </dl>

        <ChannelLinker
          channels={availableChannels().map((c) => ({
            ...c,
            linked: links.find((l) => l.kind === c.kind) ? maskAddress(c.kind, links.find((l) => l.kind === c.kind)!.address) : null,
          }))}
        />
        <OwnAgent
          brief={agent?.agentBrief ?? ""}
          on={agent?.agentOn ?? false}
          activity={activity}
          keys={<AgentKeys keys={agentKeys} mcpUrl={`${base}/api/mcp`} bare />}
        />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <QuestBoard quests={quests} />
          <UpcomingPanel items={cf.upcoming} buyer={false} />
        </div>

        <TransactionsGrid txs={cf.transactions} title="Payments received" showSeller={false} />
        <p className="text-xs text-faint">
          Rupiah amounts are estimates: PayPal fee {PAYPAL_FEE_PCT}% + 0.55 per payment, as charged in the sandbox, and assumed rates of Rp{" "}
          {IDR_PER.EUR.toLocaleString("id-ID")} per euro and Rp {IDR_PER.USD.toLocaleString("id-ID")} per dollar. Your PayPal account shows the real figures.
        </p>
      </div>
    </>
  );
}

type QuestRow = {
  id: string;
  title: string;
  needText: string;
  spec: unknown;
  status: string;
  currency: string;
  destinationCountry: string;
  budgetCents: number;
  closesAt: Date;
  photos: unknown;
  bids: { id: string }[];
  award: { bidId: string } | null;
  criteria: { name: string; weightPct: number }[];
  _count: { bids: number };
};

/** One card on the quest board. Only this seller's own bid and the bid count are used,
 * except after an award, when a seller who lost sees the winner's delivered cost and score. */
async function toQuest(t: QuestRow): Promise<Quest> {
  const spec = (t.spec ?? {}) as { item?: string; quantity?: number; deliverTo?: string; deliveryDays?: number };
  const myBidId = t.bids[0]?.id ?? null;
  const winnerBidId = t.award?.bidId ?? null;
  const won = !!myBidId && myBidId === winnerBidId;
  const lost = !!myBidId && !!winnerBidId && !won;
  const state: QuestState =
    t.status === "OPEN" ? (myBidId ? "sealed" : "open") : won ? "won" : lost ? "lost" : myBidId ? "review" : "closed";

  let reason: string | null = null;
  let photo = Array.isArray(t.photos) && typeof t.photos[0] === "string" ? (t.photos[0] as string) : null;
  if (lost || won) {
    const v = await getTenderView(t.id);
    const mine = v?.bids.find((x) => x.id === myBidId);
    const winner = v?.bids.find((x) => x.id === winnerBidId);
    photo ??= mine?.photos[0] ?? null;
    if (lost && v && mine && winner) {
      const m = (cents: number) => money(cents, t.currency);
      const gap = mine.deliveredCents - winner.deliveredCents;
      const rank = rankBids(v.bids).findIndex((x) => x.id === myBidId) + 1;
      reason =
        `The winning bid cost ${m(winner.deliveredCents)} delivered; yours ${m(mine.deliveredCents)}${gap > 0 ? ` (${m(gap)} more)` : ""}. ` +
        `Score ${(mine.total ?? 0).toFixed(1)} against ${(winner.total ?? 0).toFixed(1)}; you ranked ${rank} of ${v.bids.length}.` +
        (mine.overBudget ? " Yours was over the budget." : "");
    }
  }

  return {
    id: t.id,
    title: t.title,
    needText: t.needText,
    item: spec.item ?? t.title,
    quantity: Number(spec.quantity ?? 0),
    deliverTo: spec.deliverTo ?? "",
    country: t.destinationCountry,
    currency: t.currency,
    budgetCents: t.budgetCents,
    closesAt: t.closesAt.toISOString(),
    closesInHours: (t.closesAt.getTime() - Date.now()) / 3_600_000,
    deliveryDays: Number(spec.deliveryDays ?? 28),
    bidCount: t._count.bids,
    criteria: t.criteria,
    photo,
    state,
    reason,
  };
}

/** The money ledger: one sheet, ruled into columns. */
const LEDGER = "notice grid grid-cols-2 divide-line [&>*]:border-line max-sm:[&>*:nth-child(-n+2)]:border-b sm:grid-cols-4 sm:divide-x";

function Kpi({ label, value, note }: { label: string; value: string; note: ReactNode }) {
  return (
    <div className="grid content-start gap-1 p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="grid gap-0.5">
        <span className="num text-[22px] font-semibold leading-tight">{value}</span>
        <span className="text-xs text-faint">{note}</span>
      </dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num font-semibold">{value}</dd>
    </div>
  );
}
