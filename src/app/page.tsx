import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { CashflowChart } from "@/components/CashflowChart";
import { QuestBoard, type Quest, type QuestState } from "@/components/QuestBoard";
import { ChannelLinker } from "@/components/ChannelLinker";
import { TransactionsGrid } from "@/components/TransactionsGrid";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Panel, SectionTitle, linkButton } from "@/components/ui";
import { buyerCashflow, sellerCashflow, type UpcomingPayment } from "@/lib/cashflow";
import { availableChannels, linksOf } from "@/lib/channels";
import { db } from "@/lib/db";
import { maskAddress } from "@/lib/channels/types";
import { day, money } from "@/lib/format";
import { getUser } from "@/lib/session";
import { getTenderView } from "@/lib/tender-data";
import { atLeast, rankBids, type TenderSummary } from "@/lib/views";

export const metadata = { title: "Dashboard · FairBid" };

export default async function Home() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user.role === "buyer" ? <BuyerHome name={user.name} buyerId={user.id} /> : <SellerHome sellerId={user.sellerId!} name={user.name} />;
}

// ── Buyer ────────────────────────────────────────────────────────────────────

async function BuyerHome({ name, buyerId }: { name: string; buyerId: string }) {
  const cf = await buyerCashflow(buyerId);
  const active = cf.tenders.filter((t) => t.status !== "COMPLETE" && t.status !== "CANCELLED");
  const done = cf.tenders.filter((t) => t.status === "COMPLETE");
  // One figure per currency in use, never added across currencies: "€3,380 + $500".
  const total = (key: "heldCents" | "paidCents" | "releasedCents" | "savedCents") => sumText(cf.totals.map((c) => [c[key], c.currency]));
  const any = (key: "heldCents" | "releasedCents") => cf.totals.some((c) => c[key] > 0);
  const charts = cf.totals.filter((c) => c.currency === "EUR" || c.months.some((m) => m.paidCents || m.heldCents));

  return (
    <>
      <PageHeader
        title={`Good morning, ${name}`}
        description="Your tenders and your money: what PayPal holds for you, what you have paid, and what is due next."
        actions={
          <Link href="/post" className={linkButton.primary}>
            Post a tender
          </Link>
        }
      />
      <div className="grid gap-8">
        <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Kpi tone="dye" label="Held by PayPal" value={total("heldCents")} note={any("heldCents") ? "Still in your account, reserved" : "Nothing on hold right now"} />
          <Kpi
            tone="ok"
            label="Paid to sellers"
            value={total("paidCents")}
            note={any("releasedCents") ? `${total("releasedCents")} released, never charged` : "Only after you confirm a step"}
          />
          <Kpi tone="sun" label="Saved against lowest quotes" value={total("savedCents")} note="Compared at delivered cost" />
          <Kpi tone="warn" label="Waiting on sellers" value={String(cf.waiting)} note={cf.waiting ? "Questions not answered yet" : "No open questions"} />
        </dl>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Panel className="grid content-start gap-4">
            <div className="grid gap-0.5">
              <h2 className="text-base">Cash flow</h2>
              <p className="text-sm text-muted">Last four months. Money leaves your account only when you confirm a step.</p>
            </div>
            {charts.map((c) => (
              <div key={c.currency} className="grid gap-2">
                {charts.length > 1 && <h3 className="text-sm text-muted">In {c.currency}</h3>}
                <CashflowChart months={c.months} currency={c.currency} />
              </div>
            ))}
          </Panel>
          <UpcomingPanel items={cf.upcoming} buyer />
        </div>

        <section className="grid gap-3" aria-labelledby="active-title">
          <SectionTitle id="active-title">Active tenders</SectionTitle>
          {active.length === 0 ? (
            <p className="notice rounded-xl p-5 text-sm text-muted">
              No active tenders.{" "}
              <Link href="/post" className="font-medium text-dye underline underline-offset-4">
                Post one
              </Link>{" "}
              to get sealed bids.
            </p>
          ) : (
            <ul className="grid gap-3">
              {active.map((t) => (
                <li key={t.id}>
                  <TenderCard t={t} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <TransactionsGrid txs={cf.transactions} title="Transactions" showSeller />

        <section className="grid gap-3" aria-labelledby="done-title">
          <SectionTitle id="done-title" aside="Paid through PayPal on delivery">
            Completed tenders
          </SectionTitle>
          {done.length === 0 ? (
            <p className="text-sm text-muted">Completed tenders appear here with what you paid and saved.</p>
          ) : (
            <ul className="notice divide-y divide-line overflow-hidden rounded-xl">
              {done.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/tender/${t.id}/award`}
                    className="grid gap-x-4 gap-y-0.5 px-5 py-3 text-sm hover:bg-canvas sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_100px_110px]"
                  >
                    <span className="font-medium">{t.title}</span>
                    <span className="text-muted">{t.winnerName}</span>
                    <span className="num sm:text-right">{money(t.paidCents, t.currency)}</span>
                    <span className="num text-ok sm:text-right">{money(t.savedCents, t.currency)} saved</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
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

const STEPS = ["Sealed bids", "Questions", "Compare", "Award and pay"];

function TenderCard({ t }: { t: TenderSummary }) {
  const done = [atLeast(t.status, "CLOSED"), atLeast(t.status, "SCORED"), atLeast(t.status, "AWARDED"), t.status === "COMPLETE"];
  const current = done.indexOf(false);
  return (
    <Link
      href={`/tender/${t.id}`}
      className="notice group grid gap-5 overflow-hidden rounded-xl p-4 transition-colors hover:border-line-strong sm:grid-cols-[96px_minmax(0,1fr)] sm:p-5"
    >
      <div className="relative hidden aspect-square overflow-hidden rounded-lg bg-canvas ring-1 ring-line sm:block">
        {t.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.photo} alt="" className="h-full w-full object-cover" />
        ) : (
          // No reference photo: a parcel glyph, so the tile never looks broken.
          <svg viewBox="0 0 24 24" className="absolute inset-0 m-auto h-9 w-9 text-faint" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
            <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" />
            <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9M7.75 5.25l8.5 4.5" />
          </svg>
        )}
      </div>
      <div className="grid min-w-0 gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <StatusPill status={t.status} waiting={t.waitingReplies} heldCents={t.heldCents} />
            <h2 className="text-lg group-hover:text-dye">{t.title}</h2>
            <p className="text-sm text-muted">Deliver by {day(t.deliverBy)}.</p>
          </div>
          <dl className="grid grid-cols-3 gap-5 text-sm sm:text-right">
            <Stat label="Budget" value={money(t.budgetCents, t.currency)} />
            <Stat label="Bids" value={String(t.bidCount)} />
            <Stat label={t.status === "OPEN" ? "Closes" : "Closed"} value={day(t.closesAt).slice(0, -5)} />
          </dl>
        </div>
        <ol className="grid grid-cols-4 gap-1.5" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className="grid gap-1.5">
              <span className={`h-1 rounded-full ${done[i] ? "bg-dye" : i === current ? "bg-dye/40" : "bg-line"}`} aria-hidden="true" />
              <span className={`truncate text-xs ${i === current ? "font-medium text-ink" : "text-faint"}`}>
                {s}
                <span className="sr-only">{done[i] ? ", done" : i === current ? ", current" : ""}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
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
  const [cf, links, tenders] = await Promise.all([
    sellerCashflow(sellerId),
    linksOf(sellerId),
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
        <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Kpi tone="ok" label="Received through PayPal" value={sumText(received.map(([cur, r]) => [r.cents, cur]))} note={`${cf.transactions.length} payments`} />
          <Kpi tone="sun" label="In rupiah, after PayPal fees" value={idr(rupiah)} note="Estimate, after PayPal fees" />
          <Kpi tone="dye" label="Due to you next" value={dueText} note={dueNext ? "When the buyer confirms the step" : "Nothing due right now"} />
          <Kpi tone="warn" label="Waiting for your bid" value={String(open)} note={open ? "Open tenders you have not bid on" : "You have bid on every open tender"} />
        </dl>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <QuestBoard quests={quests} />
          <UpcomingPanel items={cf.upcoming} buyer={false} />
        </div>

        <TransactionsGrid txs={cf.transactions} title="Payments received" showSeller={false} />
        <ChannelLinker
          channels={availableChannels().map((c) => ({
            ...c,
            linked: links.find((l) => l.kind === c.kind) ? maskAddress(c.kind, links.find((l) => l.kind === c.kind)!.address) : null,
          }))}
        />
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

const tint = { dye: "bg-dye", ok: "bg-ok", sun: "bg-sun", warn: "bg-warn" };

function Kpi({ tone, label, value, note }: { tone: keyof typeof tint; label: string; value: string; note: ReactNode }) {
  return (
    <div className="notice grid content-between gap-3 rounded-xl p-3.5 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <dt className="text-sm text-muted">{label}</dt>
        <span className={`h-2 w-2 rounded-full ${tint[tone]}`} aria-hidden="true" />
      </div>
      <dd className="grid gap-0.5">
        <span className="num text-[22px] font-semibold leading-none tracking-tight sm:text-[26px]">{value}</span>
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
