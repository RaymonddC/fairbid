// Reads tenders for the screens and applies the sealed rule on the server: while
// a tender is sealed, nothing about other sellers' bids leaves here except the count.

import { db } from "./db";
import { holdCents, landedCost, type TariffInput } from "./landed";
import { DEMO_QUESTIONS } from "./review-fixture";
import { bidLetter, criterionKind, weightedTotal } from "./scoring";
import { isSealed, milestoneAmounts, type TenderStatus } from "./tender";
import {
  atLeast,
  type AwardView,
  type BidView,
  type ClarificationView,
  type CriterionView,
  type FlagView,
  type MilestoneView,
  type SellerTenderView,
  type Spec,
  type TenderSummary,
  type TenderView,
} from "./views";

const photosOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);

const specOf = (value: unknown): Spec => {
  const s = (value ?? {}) as Partial<Spec>;
  return {
    item: s.item ?? "",
    quantity: Number(s.quantity ?? 0),
    deliverTo: s.deliverTo ?? "",
    deliveryDays: Number(s.deliveryDays ?? 28),
  };
};

const topicOf = (question: string) => {
  const scripted = DEMO_QUESTIONS.find((q) => q.question === question)?.topic;
  if (scripted) return scripted;
  const first = question.split(/[?.!]/)[0].trim();
  return first.length > 48 ? `${first.slice(0, 46).trimEnd()}…` : first || "Question";
};

/** The tariff for a customs code and destination: the longest matching prefix,
 * latest rule in force. Falls back to any rule for the destination. */
export async function tariffFor(hsCode: string | null, destination: string): Promise<TariffInput> {
  const rates = await db.tariffRate.findMany({
    where: { destination, effectiveFrom: { lte: new Date() } },
    orderBy: { effectiveFrom: "desc" },
  });
  const digits = (hsCode ?? "").replace(/\D/g, "");
  const match =
    rates.filter((r) => digits.startsWith(r.hsPrefix)).sort((a, b) => b.hsPrefix.length - a.hsPrefix.length)[0] ?? rates[0];
  if (!match) throw new Error(`No tariff rule for ${destination}. Run npm run db:seed.`);
  return {
    dutyPct: Number(match.dutyPct),
    vatPct: Number(match.vatPct),
    asOf: match.effectiveFrom.toISOString().slice(0, 10),
  };
}

const line = (lines: { kind: string; amountCents: number }[], kind: string) =>
  lines.find((l) => l.kind === kind)?.amountCents ?? 0;

async function loadTender(id: string) {
  return db.tender.findUnique({
    where: { id },
    include: {
      criteria: { orderBy: { weightPct: "desc" } },
      bids: {
        include: { lines: true, scores: true, seller: true, flags: true, pairedIn: true },
        orderBy: [{ submittedAt: "asc" }, { sellerId: "asc" }],
      },
      clarifications: { include: { replies: true }, orderBy: { sentAt: "asc" } },
      award: {
        include: {
          authorization: { include: { captures: true } },
          milestones: { include: { capture: true }, orderBy: { seq: "asc" } },
        },
      },
    },
  });
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadTender>>>;

function milestoneViews(award: NonNullable<Loaded["award"]>): MilestoneView[] {
  const planned = milestoneAmounts(
    award.holdCents,
    award.milestones.map((m) => ({ name: m.name, pct: m.pct })),
  );
  return award.milestones.map((m, i) => ({
    id: m.id,
    seq: m.seq,
    name: m.name,
    pct: m.pct,
    plannedCents: planned[i],
    status: m.status,
    capture: m.capture
      ? {
          paypalCaptureId: m.capture.paypalCaptureId,
          amountCents: m.capture.amountCents,
          final: m.capture.finalCapture,
          status: m.capture.status,
        }
      : null,
  }));
}

/** The buyer's view of one tender. */
export async function getTenderView(id: string): Promise<TenderView | null> {
  const t = await loadTender(id);
  if (!t) return null;
  const status = t.status as TenderStatus;
  const sealed = isSealed(status);
  const criteria: CriterionView[] = t.criteria.map((c) => ({
    id: c.id,
    name: c.name,
    weightPct: c.weightPct,
    rubric: c.rubric,
    kind: criterionKind(c.name),
  }));

  const letters = new Map(t.bids.map((b, i) => [b.id, bidLetter(i)]));
  const flaggedIds = new Set(t.bids.flatMap((b) => [...b.flags, ...b.pairedIn].map(() => b.id)));
  const scored = atLeast(status, "SCORED");
  const winnerId = t.award?.bidId ?? null;

  const bids: BidView[] = [];
  if (!sealed) {
    for (const b of t.bids) {
      const landed = landedCost(
        { goodsCents: line(b.lines, "goods"), shippingCents: line(b.lines, "shipping"), feesCents: line(b.lines, "fees") },
        await tariffFor(b.hsCode, t.destinationCountry),
      );
      const scores = b.scores.map((s) => ({ criterionId: s.criterionId, score: s.score, reason: s.reason }));
      bids.push({
        id: b.id,
        letter: letters.get(b.id)!,
        country: b.seller.country,
        leadTimeDays: b.leadTimeDays,
        notes: b.notes,
        hsCode: b.hsCode,
        hsConfidence: b.hsConfidence === null ? null : Number(b.hsConfidence),
        photos: photosOf(b.photos),
        submittedAt: b.submittedAt.toISOString(),
        goodsCents: landed.goodsCents,
        shippingCents: landed.shippingCents,
        feesCents: landed.feesCents,
        dutyCents: landed.dutyCents,
        vatCents: landed.vatCents,
        deliveredCents: landed.deliveredReclaimedCents,
        deliveredGrossCents: landed.deliveredGrossCents,
        holdCents: holdCents(landed),
        overBudget: landed.deliveredReclaimedCents > t.budgetCents,
        scores,
        total:
          scored && scores.length
            ? weightedTotal(
                scores.map((s) => ({ score: s.score, weightPct: criteria.find((c) => c.id === s.criterionId)?.weightPct ?? 0 })),
              )
            : null,
        flagged: flaggedIds.has(b.id),
        sellerName: b.id === winnerId ? b.seller.name : null,
      });
    }
  }

  const clarifications: ClarificationView[] = sealed
    ? []
    : t.clarifications.map((c) => {
        const sentTo = (Array.isArray(c.sentTo) ? (c.sentTo as string[]) : [])
          .map((sellerId) => t.bids.find((b) => b.sellerId === sellerId)?.id)
          .filter((x): x is string => !!x);
        const replies = c.replies
          .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
          .map((r) => ({ letter: letters.get(r.bidId) ?? "?", body: r.body, at: r.receivedAt.toISOString(), channel: r.channel }));
        return {
          id: c.id,
          topic: topicOf(c.question),
          question: c.question,
          sentAt: c.sentAt.toISOString(),
          sentTo: sentTo.map((id) => letters.get(id)!),
          replies,
          waiting: sentTo.filter((id) => !c.replies.some((r) => r.bidId === id)).map((id) => letters.get(id)!),
        };
      });

  const flags: FlagView[] = sealed
    ? []
    : t.bids.flatMap((b) =>
        b.flags.map((f) => ({
          letters: [letters.get(f.bidId)!, letters.get(f.pairedBidId)!],
          reason: f.reason,
          evidence: Array.isArray(f.evidence) ? (f.evidence as string[]) : [],
        })),
      );

  let award: AwardView | null = null;
  if (t.award) {
    const win = t.bids.find((b) => b.id === t.award!.bidId)!;
    const view = bids.find((b) => b.id === win.id);
    const milestones = milestoneViews(t.award);
    const paidCents = milestones.reduce((s, m) => s + (m.capture?.amountCents ?? 0), 0);
    const complete = milestones.some((m) => m.capture?.final);
    const a = t.award.authorization;
    award = {
      bidId: win.id,
      letter: letters.get(win.id)!,
      sellerName: win.seller.name,
      sellerCountry: win.seller.country,
      payeeEmail: win.seller.paypalEmail,
      holdCents: t.award.holdCents,
      deliveredCents: view?.deliveredCents ?? t.award.holdCents,
      photos: photosOf(win.photos),
      authorization: a
        ? {
            status: a.status,
            paypalOrderId: a.paypalOrderId,
            paypalAuthId: a.paypalAuthId,
            expiresAt: a.expiresAt?.toISOString() ?? null,
            amountCents: a.amountCents,
          }
        : null,
      milestones,
      paidCents,
      releasedCents: complete ? t.award.holdCents - paidCents : 0,
      complete,
      holdDaysLeft: a?.expiresAt ? Math.ceil((a.expiresAt.getTime() - Date.now()) / 86_400_000) : null,
    };
  }

  const cheapestQuote = [...bids].sort((a, b) => a.goodsCents - b.goodsCents)[0];
  const winnerView = award ? bids.find((b) => b.id === award!.bidId) : undefined;

  return {
    id: t.id,
    title: t.title,
    needText: t.needText,
    spec: specOf(t.spec),
    budgetCents: t.budgetCents,
    currency: t.currency,
    destinationCountry: t.destinationCountry,
    vatReclaimable: t.vatReclaimable,
    closesAt: t.closesAt.toISOString(),
    status,
    sealed,
    photos: photosOf(t.photos),
    criteria,
    bidCount: t.bids.length,
    bids,
    clarifications,
    flags,
    award,
    waitingReplies: clarifications.reduce((n, c) => n + c.waiting.length, 0),
    savedCents: cheapestQuote && winnerView ? cheapestQuote.deliveredCents - winnerView.deliveredCents : null,
  };
}

/** A seller's view: the tender, their own bid, their questions, and their pay if they won. */
export async function getSellerTenderView(id: string, sellerId: string): Promise<SellerTenderView | null> {
  const t = await loadTender(id);
  if (!t) return null;
  const status = t.status as TenderStatus;
  const mine = t.bids.find((b) => b.sellerId === sellerId);
  const tariff = await tariffFor(mine?.hsCode ?? "6302", t.destinationCountry);
  const won = t.award && mine && t.award.bidId === mine.id ? t.award : null;
  const milestones = won ? milestoneViews(won) : [];

  return {
    id: t.id,
    title: t.title,
    needText: t.needText,
    spec: specOf(t.spec),
    budgetCents: t.budgetCents,
    currency: t.currency,
    destinationCountry: t.destinationCountry,
    closesAt: t.closesAt.toISOString(),
    status,
    open: status === "OPEN" && new Date() < t.closesAt,
    photos: photosOf(t.photos),
    criteria: t.criteria.map((c) => ({ id: c.id, name: c.name, weightPct: c.weightPct, rubric: c.rubric, kind: criterionKind(c.name) })),
    dutyPct: tariff.dutyPct,
    vatPct: tariff.vatPct,
    myBid: mine
      ? {
          goodsCents: line(mine.lines, "goods"),
          shippingCents: line(mine.lines, "shipping"),
          feesCents: line(mine.lines, "fees"),
          leadTimeDays: mine.leadTimeDays,
          notes: mine.notes,
          hsCode: mine.hsCode,
          photos: photosOf(mine.photos),
          submittedAt: mine.submittedAt.toISOString(),
        }
      : null,
    questions: t.clarifications
      .filter((c) => Array.isArray(c.sentTo) && (c.sentTo as string[]).includes(sellerId))
      .map((c) => ({
        id: c.id,
        topic: topicOf(c.question),
        question: c.question,
        sentAt: c.sentAt.toISOString(),
        myReply: c.replies.find((r) => r.bidId === mine?.id)?.body ?? null,
      })),
    won: won
      ? { holdCents: won.holdCents, paidCents: milestones.reduce((s, m) => s + (m.capture?.amountCents ?? 0), 0), milestones }
      : null,
  };
}

/** Every tender, newest first, with the money figures the dashboard shows. */
export async function listTenders(): Promise<TenderSummary[]> {
  const tenders = await db.tender.findMany({ orderBy: { createdAt: "desc" }, select: { id: true } });
  const views = await Promise.all(tenders.map((t) => getTenderView(t.id)));
  return views
    .filter((v): v is TenderView => !!v)
    .map((v) => {
      const capturedFinal = v.award?.complete ?? false;
      const authorized = v.award?.authorization?.paypalAuthId != null;
      return {
        id: v.id,
        title: v.title,
        status: v.status,
        budgetCents: v.budgetCents,
        currency: v.currency,
        closesAt: v.closesAt,
        bidCount: v.bidCount,
        deliverBy: deliverBy(v.closesAt, v.spec.deliveryDays),
        photo: v.photos[0] ?? v.award?.photos[0] ?? null,
        heldCents: v.award && authorized && !capturedFinal ? v.award.holdCents - v.award.paidCents : 0,
        paidCents: v.award?.paidCents ?? 0,
        savedCents: v.savedCents ?? 0,
        waitingReplies: v.waitingReplies,
        winnerName: v.award?.sellerName ?? null,
      };
    });
}

/** Delivery deadline: the window counted from the close. */
export function deliverBy(closesAt: string, deliveryDays: number): string {
  return new Date(new Date(closesAt).getTime() + deliveryDays * 86_400_000).toISOString();
}
