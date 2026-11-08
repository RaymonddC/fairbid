// Cash flow for the dashboards, read from the event log: it is the only place a
// payment's time is recorded, and it is tamper-evident (audit.ts).

import { db } from "./db";
import { isFailedCapture } from "./paypal/webhook";
import { isLive, nextStep } from "./phases";
import { milestoneAmounts } from "./tender";
import { listTenders } from "./tender-data";
import type { TenderSummary } from "./views";

export type TxKind = "hold" | "payment" | "release";

export interface Transaction {
  at: string;
  tenderId: string;
  tenderTitle: string;
  currency: string;
  kind: TxKind;
  label: string;
  amountCents: number;
  ref: string | null;
  sellerName: string | null;
}

export interface MonthFlow {
  /** "2026-10" */
  month: string;
  label: string;
  paidCents: number;
  releasedCents: number;
  /** Still held by PayPal at the end of the month. */
  heldCents: number;
}

export interface UpcomingPayment {
  tenderId: string;
  tenderTitle: string;
  milestone: string;
  plannedCents: number;
  currency: string;
  holdExpiresAt: string | null;
  daysLeft: number | null;
  /** Set when the step cannot be paid until the buyer approves a hold for its phase. */
  needsHold: { phase: number; amountCents: number; replacing: boolean } | null;
  sellerName: string;
}

interface Paid {
  amountCents?: number;
  milestone?: string;
  paypalCaptureId?: string;
  releasedCents?: number;
  paypalAuthId?: string;
  phase?: number;
  unusedCents?: number;
}

async function transactions(filter: { sellerId?: string; buyerId?: string }): Promise<Transaction[]> {
  const { sellerId, buyerId } = filter;
  const events = await db.event.findMany({
    where: {
      kind: { in: ["award.authorized", "hold.authorized", "milestone.paid", "paypal.hold.released"] },
      ...(sellerId ? { tender: { award: { bid: { sellerId } } } } : {}),
      ...(buyerId ? { tender: { buyerId } } : {}),
    },
    orderBy: { at: "asc" },
    include: { tender: { select: { title: true, currency: true, award: { select: { bid: { select: { seller: { select: { name: true } } } } } } } } },
  });
  const out: Transaction[] = [];
  for (const e of events) {
    const p = (e.payload ?? {}) as Paid;
    const base = {
      at: e.at.toISOString(),
      tenderId: e.tenderId,
      tenderTitle: e.tender.title,
      currency: e.tender.currency,
      sellerName: e.tender.award?.bid.seller.name ?? null,
    };
    if (e.kind === "award.authorized" || e.kind === "hold.authorized") {
      const label = p.phase && p.phase > 1 ? `Hold placed, phase ${p.phase}` : "Hold placed";
      out.push({ ...base, kind: "hold", label, amountCents: p.amountCents ?? 0, ref: p.paypalAuthId ?? null });
    } else if (e.kind === "paypal.hold.released") {
      // A hold that lapsed with money unused: it went back to the buyer without a capture.
      if (p.unusedCents) out.push({ ...base, kind: "release", label: "Hold lapsed, back to the buyer", amountCents: p.unusedCents, ref: p.paypalAuthId ?? null });
    } else {
      out.push({ ...base, kind: "payment", label: p.milestone ?? "Payment", amountCents: p.amountCents ?? 0, ref: p.paypalCaptureId ?? null });
      if (p.releasedCents) {
        out.push({ ...base, kind: "release", label: "Released, never charged", amountCents: p.releasedCents, ref: null });
      }
    }
  }
  return out;
}

const monthKey = (iso: string) => iso.slice(0, 7);

/** The last `count` months, oldest first, ending with the current month. */
function lastMonths(count: number, now = new Date()): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

function monthly(txs: Transaction[], count = 4): MonthFlow[] {
  const months = lastMonths(count);
  let held = 0;
  // Holds and payments before the window still count towards what is held.
  const before = txs.filter((t) => monthKey(t.at) < months[0]);
  for (const t of before) held += t.kind === "hold" ? t.amountCents : -t.amountCents;
  return months.map((m) => {
    const inMonth = txs.filter((t) => monthKey(t.at) === m);
    const paid = inMonth.filter((t) => t.kind === "payment").reduce((s, t) => s + t.amountCents, 0);
    const released = inMonth.filter((t) => t.kind === "release").reduce((s, t) => s + t.amountCents, 0);
    held += inMonth.reduce((s, t) => s + (t.kind === "hold" ? t.amountCents : -t.amountCents), 0);
    const label = new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
    return { month: m, label, paidCents: paid, releasedCents: released, heldCents: Math.max(0, held) };
  });
}

async function upcoming(tenders: TenderSummary[], sellerId?: string): Promise<UpcomingPayment[]> {
  const awards = await db.award.findMany({
    where: {
      tenderId: { in: tenders.map((t) => t.id) },
      endedAt: null,
      authorizations: { some: { paypalAuthId: { not: null } } },
      ...(sellerId ? { bid: { sellerId } } : {}),
    },
    include: {
      tender: { select: { title: true, currency: true } },
      authorizations: { orderBy: { seq: "asc" } },
      bid: { select: { seller: { select: { name: true } } } },
      milestones: { include: { capture: true }, orderBy: { seq: "asc" } },
    },
  });
  const now = new Date();
  return awards.flatMap((a) => {
    const planned = milestoneAmounts(a.holdCents, a.milestones.map((m) => ({ name: m.name, pct: m.pct })));
    const step = nextStep(
      a.milestones.map((m, i) => ({ phase: m.phase, plannedCents: planned[i], paid: !!m.capture && !isFailedCapture(m.capture.status) })),
      a.authorizations.map((h) => ({ phase: h.phase, paypalAuthId: h.paypalAuthId, status: h.status, expiresAt: h.expiresAt })),
      now,
    );
    if (step.kind === "done") return [];
    const next = a.milestones[step.index];
    const hold = step.kind === "pay" ? [...a.authorizations].reverse().find((h) => h.phase === step.phase && isLive(h, now)) : undefined;
    const exp = hold?.expiresAt ?? null;
    return [
      {
        tenderId: a.tenderId,
        tenderTitle: a.tender.title,
        currency: a.tender.currency,
        milestone: next.name,
        plannedCents: planned[step.index],
        holdExpiresAt: exp?.toISOString() ?? null,
        daysLeft: exp ? Math.ceil((exp.getTime() - now.getTime()) / 86_400_000) : null,
        needsHold: step.kind === "hold" ? { phase: step.phase, amountCents: step.amountCents, replacing: step.replacing } : null,
        sellerName: a.bid.seller.name,
      },
    ];
  });
}

/** Money per currency: euros and dollars are never added together. */
export interface CurrencyTotals {
  currency: string;
  heldCents: number;
  paidCents: number;
  releasedCents: number;
  savedCents: number;
  months: MonthFlow[];
}

/** Currencies in use, euro first. Always at least euro, so an empty dashboard still reads "€0". */
function currenciesOf(tenders: TenderSummary[]): string[] {
  const set = new Set(["EUR", ...tenders.map((t) => t.currency)]);
  return [...set].sort((a, b) => (a === "EUR" ? -1 : b === "EUR" ? 1 : a.localeCompare(b)));
}

/** Everything the buyer's dashboard shows about money. */
export async function buyerCashflow(buyerId: string) {
  const [tenders, txs] = await Promise.all([listTenders(buyerId), transactions({ buyerId })]);
  const totals: CurrencyTotals[] = currenciesOf(tenders).map((currency) => {
    const ts = tenders.filter((t) => t.currency === currency);
    const xs = txs.filter((t) => t.currency === currency);
    return {
      currency,
      heldCents: ts.reduce((s, t) => s + t.heldCents, 0),
      paidCents: xs.filter((t) => t.kind === "payment").reduce((s, t) => s + t.amountCents, 0),
      releasedCents: xs.filter((t) => t.kind === "release").reduce((s, t) => s + t.amountCents, 0),
      savedCents: ts.reduce((s, t) => s + t.savedCents, 0),
      months: monthly(xs),
    };
  });
  return {
    tenders,
    totals,
    waiting: tenders.reduce((s, t) => s + t.waitingReplies, 0),
    upcoming: await upcoming(tenders),
    transactions: [...txs].reverse(),
  };
}

/** What a seller has been paid and is still due, across the tenders they won. */
export async function sellerCashflow(sellerId: string) {
  const tenders = await listTenders();
  const txs = (await transactions({ sellerId })).filter((t) => t.kind === "payment");
  const received: Record<string, { cents: number; payments: number }> = {};
  for (const t of txs) {
    received[t.currency] ??= { cents: 0, payments: 0 };
    received[t.currency].cents += t.amountCents;
    received[t.currency].payments += 1;
  }
  return {
    received,
    transactions: [...txs].reverse(),
    upcoming: await upcoming(tenders, sellerId),
  };
}
