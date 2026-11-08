// Server-side steps of a tender, called by the server actions. Each one checks
// the tender's state, moves it with assertTransition, and records an event.
// Identity always comes from the session, never from an argument.

import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client";
import { appendEvent } from "./audit-store";
import { db } from "./db";
import { holdCents, landedCost } from "./landed";
import { log } from "./log";
import { createPayPalClient, loadConfig, PayPalError, PayPalUnreachableError, type PayPalClient } from "./paypal/client";
import { isFailedCapture, reasonText } from "./paypal/webhook";
import { isLastOfPhase, isLive, MAX_DELIVERY_DAYS, nextStep, phaseCount, planMilestones, type HoldState, type MilestoneState } from "./phases";
import { explainPair, reviewProposals, scoreBlind } from "./ai/roles";
import { DEMO_QUESTIONS, DEMO_REVIEWED_SCORES, UNREVIEWED, type FixtureQuestion } from "./review-fixture";
import {
  bidLetter,
  completenessScore,
  costScore,
  criterionKind,
  findCoordinatedPairs,
  formatEur,
  leadTimeScore,
} from "./scoring";
import { assertTransition, canSubmitBid, milestoneAmounts, type TenderStatus } from "./tender";
import { tariffFor } from "./tender-data";
import { DEMO_TENDER_ID } from "../../prisma/seed-data";
import { DESTINATIONS } from "./format";

/** Only the buyer who posted a tender may run it. Throws for anyone else. */
export async function assertOwner(tenderId: string, buyerId: string) {
  const t = await db.tender.findUnique({ where: { id: tenderId }, select: { buyerId: true } });
  if (!t || t.buyerId !== buyerId) throw new StepError("This tender belongs to another buyer.");
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export class StepError extends Error {}

let paypal: PayPalClient | null = null;
const pp = () => (paypal ??= createPayPalClient(loadConfig()));

/** Swaps in a stand-in PayPal client, for scripts that run the money steps against a
 * local database without the sandbox. The app never calls it. */
export function setPayPalClient(client: PayPalClient | null): void {
  paypal = client;
}

type Tx = Prisma.TransactionClient;

/** Moves a tender only if it is still in `from`, so two clicks cannot both win. */
async function move(tx: Tx, tenderId: string, from: TenderStatus, to: TenderStatus) {
  assertTransition(from, to);
  const { count } = await tx.tender.updateMany({ where: { id: tenderId, status: from }, data: { status: to } });
  if (count !== 1) throw new StepError("This tender changed in the meantime. Reload the page.");
}

async function statusOf(tenderId: string): Promise<TenderStatus> {
  const t = await db.tender.findUnique({ where: { id: tenderId }, select: { status: true } });
  if (!t) throw new StepError("Tender not found.");
  return t.status as TenderStatus;
}

const lineOf = (lines: { kind: string; amountCents: number }[], kind: string) =>
  lines.find((l) => l.kind === kind)?.amountCents ?? 0;

// ── Close and review ─────────────────────────────────────────────────────────

/** Demo shortcut for the deadline: opens every bid at once, then runs the review
 * (questions to sellers, collusion check). */
export async function closeBidding(tenderId: string, actor: string) {
  if ((await statusOf(tenderId)) !== "OPEN") throw new StepError("Bidding is already closed.");
  // Same order as the screens, so the letters the AI uses match the letters people see.
  const bids = await db.bid.findMany({ where: { tenderId }, include: { lines: true }, orderBy: [{ submittedAt: "asc" }, { sellerId: "asc" }] });
  const tender = await db.tender.findUniqueOrThrow({ where: { id: tenderId }, include: { criteria: true } });
  const { currency } = tender;
  const now = new Date();
  const letterOf = new Map(bids.map((b, i) => [b.id, bidLetter(i)]));

  const pairs = findCoordinatedPairs(
    bids.map((b) => ({
      id: b.id,
      goodsCents: lineOf(b.lines, "goods"),
      shippingCents: lineOf(b.lines, "shipping"),
      feesCents: lineOf(b.lines, "fees"),
      notes: b.notes,
      submittedAt: b.submittedAt,
    })),
    currency,
  );

  // AI review, before the transaction so no database lock waits on the model.
  // The demo tender keeps its scripted questions: its seeded replies answer them.
  const sellerOfLetter = new Map(bids.map((b) => [letterOf.get(b.id)!, b.sellerId]));
  const [review, reasons] = await Promise.all([
    tenderId === DEMO_TENDER_ID
      ? Promise.resolve({ value: DEMO_QUESTIONS, source: "fixture" as const })
      : reviewProposals(
          {
            title: tender.title,
            needText: tender.needText,
            deliveryDays: Number((tender.spec as { deliveryDays?: number })?.deliveryDays ?? 28),
            criteria: tender.criteria.map((c) => ({ name: c.name, weightPct: c.weightPct, rubric: c.rubric })),
            bids: bids.map((b) => ({
              letter: letterOf.get(b.id)!,
              notes: b.notes,
              hsCode: b.hsCode,
              leadTimeDays: b.leadTimeDays,
              photoCount: Array.isArray(b.photos) ? b.photos.length : 0,
            })),
          },
          () => [],
        ).then((r) => ({
          source: r.source,
          value: r.value.map((q) => ({ topic: q.topic, question: q.question, sentTo: q.bids.map((l) => sellerOfLetter.get(l)!), replies: [] })),
        })),
    Promise.all(
      pairs.map((p) => {
        const a = bids.find((b) => b.id === p.bidId)!;
        const b = bids.find((x) => x.id === p.pairedBidId)!;
        return explainPair({ letters: [letterOf.get(a.id)!, letterOf.get(b.id)!], evidence: p.evidence, notes: [a.notes, b.notes] });
      }),
    ),
  ]);
  const questions: FixtureQuestion[] = review.value;
  const bidOf = (sellerId: string) => bids.find((b) => b.sellerId === sellerId);
  // The scripted review ran two hours before the demo close, so its seeded replies are already in the past.
  const asked = new Date(now.getTime() - 2 * 60 * 60_000);

  await db.$transaction(async (tx) => {
    await move(tx, tenderId, "OPEN", "CLOSED");
    await tx.tender.update({ where: { id: tenderId }, data: { closesAt: now } });
    await tx.bid.updateMany({ where: { tenderId }, data: { openedAt: now } });
    await move(tx, tenderId, "CLOSED", "REVIEWING");

    for (const [i, p] of pairs.entries()) {
      await tx.flag.create({
        data: {
          bidId: p.bidId,
          pairedBidId: p.pairedBidId,
          kind: "price_and_text",
          similarity: p.similarity,
          evidence: p.evidence,
          reason: reasons[i].value,
        },
      });
    }

    for (const q of questions) {
      const sentTo = q.sentTo.filter((id) => bidOf(id));
      if (sentTo.length === 0) continue;
      await tx.clarification.create({
        data: {
          tenderId,
          question: q.question,
          sentTo,
          sentAt: asked,
          replies: {
            create: q.replies
              .filter((r) => bidOf(r.sellerId))
              .map((r) => ({
                bidId: bidOf(r.sellerId)!.id,
                channel: "inapp" as const,
                body: r.body,
                receivedAt: new Date(asked.getTime() + r.minutesAfter * 60_000),
              })),
          },
        },
      });
    }
    if (questions.length) await move(tx, tenderId, "REVIEWING", "CLARIFYING");
  });

  await appendEvent(tenderId, actor, "tender.closed", { bids: bids.map((b) => ({ id: b.id, sealedHash: b.sealedHash })) });
  if (pairs.length) await appendEvent(tenderId, "review", "review.flagged", { pairs: pairs.map((p) => [p.bidId, p.pairedBidId]) });
  if (questions.length) await appendEvent(tenderId, "review", "clarification.sent", { count: questions.length });
  await appendEvent(tenderId, "ai", "review.completed", {
    questions: { count: questions.length, source: review.source },
    flagReasons: reasons.map((r) => r.source),
  });
}

/** The buyer asks sellers something. Only after bidding closes (so no seller gets an early
 * hint) and before the award. Asked after scoring, the answer is kept with the bid but the
 * scores stay as they are (they only move forward, never back). The same question goes to every bid
 * chosen, and an answer can never change a price. */
export async function askQuestion(tenderId: string, question: string, bidIds: string[], actor: string) {
  const text = question.trim().replace(/\s+/g, " ");
  if (text.length < 10) throw new StepError("Write the question in a full sentence.");
  if (text.length > 600) throw new StepError("Keep the question under 600 characters.");
  const status = await statusOf(tenderId);
  if (status === "OPEN" || status === "DRAFT") throw new StepError("You can ask once bidding closes, so no seller gets an early hint.");
  if (!["CLOSED", "REVIEWING", "CLARIFYING", "PRICED", "SCORED"].includes(status)) {
    throw new StepError("A winner is already chosen, so questions to sellers are closed.");
  }
  const unique = [...new Set(bidIds)];
  if (unique.length === 0) throw new StepError("Choose at least one bid to ask.");
  const bids = await db.bid.findMany({ where: { tenderId, id: { in: unique } }, select: { id: true, sellerId: true } });
  if (bids.length !== unique.length) throw new StepError("One of those bids is not part of this tender.");

  await db.$transaction(async (tx) => {
    await tx.clarification.create({ data: { tenderId, question: text, sentTo: bids.map((b) => b.sellerId) } });
    // A closed tender with no questions yet moves on to clarifying.
    if (status === "CLOSED") await move(tx, tenderId, "CLOSED", "REVIEWING");
    if (status === "CLOSED" || status === "REVIEWING") await move(tx, tenderId, "REVIEWING", "CLARIFYING");
  });
  await appendEvent(tenderId, actor, "clarification.asked", { bids: bids.map((b) => b.id) });
}

/** A reply to a clarification. The price is locked; a reply never changes it. */
export async function addReply(clarificationId: string, bidId: string, body: string, actor: string) {
  const text = body.trim().slice(0, 1000);
  if (!text) throw new StepError("Write a reply first.");
  const c = await db.clarification.findUnique({ where: { id: clarificationId }, include: { tender: true } });
  if (!c) throw new StepError("Question not found.");
  const bid = await db.bid.findUnique({ where: { id: bidId } });
  if (!bid || bid.tenderId !== c.tenderId) throw new StepError("That bid was not asked this question.");
  const sentTo = Array.isArray(c.sentTo) ? (c.sentTo as string[]) : [];
  if (!sentTo.includes(bid.sellerId)) throw new StepError("That bid was not asked this question.");
  await db.reply.upsert({
    where: { clarificationId_bidId: { clarificationId, bidId } },
    create: { clarificationId, bidId, body: text, channel: "inapp" },
    update: { body: text, receivedAt: new Date() },
  });
  await appendEvent(c.tenderId, actor, "clarification.replied", { clarificationId, bidId });
}

// ── Price and score ──────────────────────────────────────────────────────────

/** Prices every bid at delivered cost and scores it against the published criteria. */
export async function scoreTender(tenderId: string, actor: string) {
  const status = await statusOf(tenderId);
  if (status !== "REVIEWING" && status !== "CLARIFYING") throw new StepError("This tender is not waiting to be scored.");
  const t = await db.tender.findUniqueOrThrow({
    where: { id: tenderId },
    include: { criteria: true, bids: { include: { lines: true } } },
  });
  const windowDays = Number((t.spec as { deliveryDays?: number })?.deliveryDays ?? 28);

  const priced: { bid: (typeof t.bids)[number]; landed: ReturnType<typeof landedCost>; tariff: Awaited<ReturnType<typeof tariffFor>>; delivered: number }[] = [];
  for (const b of t.bids) {
    const tariff = await tariffFor(b.hsCode, t.destinationCountry);
    const landed = landedCost(
      { goodsCents: lineOf(b.lines, "goods"), shippingCents: lineOf(b.lines, "shipping"), feesCents: lineOf(b.lines, "fees") },
      tariff,
    );
    priced.push({ bid: b, landed, tariff, delivered: t.vatReclaimable ? landed.deliveredReclaimedCents : landed.deliveredGrossCents });
  }
  const best = Math.min(...priced.map((p) => p.delivered));

  // The criteria code cannot score are judged by the blind scorer, one anonymous bid per
  // call, in parallel and before the transaction. Each falls back to its fixture.
  const judged = t.criteria.filter((c) => !["cost", "lead_time", "completeness"].includes(criterionKind(c.name)));
  const clarifications = judged.length ? await db.clarification.findMany({ where: { tenderId }, include: { replies: true } }) : [];
  const fixtureFor = (sellerId: string) => () =>
    tenderId === DEMO_TENDER_ID ? (DEMO_REVIEWED_SCORES[sellerId] ?? UNREVIEWED) : UNREVIEWED;
  const judgedScores = new Map<string, Record<string, { score: number; reason: string }>>();
  const scoreSources: string[] = [];
  if (judged.length) {
    await Promise.all(
      t.bids.map(async (b) => {
        const r = await scoreBlind(
          {
            tender: { title: t.title, needText: t.needText },
            criteria: judged.map((c) => ({ name: c.name, rubric: c.rubric })),
            bid: { notes: b.notes, hsCode: b.hsCode, leadTimeDays: b.leadTimeDays, photos: Array.isArray(b.photos) ? (b.photos as string[]) : [] },
            clarifications: clarifications
              .filter((c) => Array.isArray(c.sentTo) && (c.sentTo as string[]).includes(b.sellerId))
              .map((c) => ({ question: c.question, reply: c.replies.find((r) => r.bidId === b.id)?.body ?? null })),
          },
          fixtureFor(b.sellerId),
        );
        judgedScores.set(b.id, r.value);
        scoreSources.push(r.source);
      }),
    );
  }

  await db.$transaction(async (tx) => {
    await move(tx, tenderId, status, "PRICED");
    for (const p of priced) {
      const source = `tariff ${p.bid.hsCode ?? "6302"} ${t.destinationCountry}, as of ${p.tariff.asOf}`;
      for (const [kind, amountCents] of [
        ["duty", p.landed.dutyCents],
        ["vat", p.landed.vatCents],
      ] as const) {
        await tx.bidLine.upsert({
          where: { bidId_kind: { bidId: p.bid.id, kind } },
          create: { bidId: p.bid.id, kind, amountCents, source },
          update: { amountCents, source },
        });
      }
      for (const c of t.criteria) {
        const kind = criterionKind(c.name);
        const s =
          kind === "cost"
            ? costScore(p.delivered, best, t.currency)
            : kind === "lead_time"
              ? leadTimeScore(p.bid.leadTimeDays, windowDays)
              : kind === "completeness"
                ? completenessScore({
                    hsCode: p.bid.hsCode,
                    notes: p.bid.notes,
                    photoCount: Array.isArray(p.bid.photos) ? p.bid.photos.length : 0,
                  })
                : (judgedScores.get(p.bid.id)?.[c.name] ?? fixtureFor(p.bid.sellerId)());
        await tx.score.upsert({
          where: { bidId_criterionId: { bidId: p.bid.id, criterionId: c.id } },
          create: { bidId: p.bid.id, criterionId: c.id, score: s.score, reason: s.reason },
          update: { score: s.score, reason: s.reason },
        });
      }
    }
    await move(tx, tenderId, "PRICED", "SCORED");
  });
  await appendEvent(tenderId, actor, "tender.scored", {
    bids: priced.length,
    judgedBy: judged.length ? (scoreSources.every((s) => s === "model") ? "model" : scoreSources.some((s) => s === "model") ? "mixed" : "fixture") : "code",
  });
}

// ── Award, hold and pay ──────────────────────────────────────────────────────
//
// An order is paid in phases (src/lib/phases.ts). Each phase has its own PayPal hold,
// approved by the buyer when the phase starts; an order of 28 days or less is one
// phase. The seller is the payee of every hold, so FairBid never holds money.

/** How long an unapproved order is reused before a new one is made. */
const ORDER_REUSE_MS = 60 * 60_000;

/** Everything about an award that the money steps read. */
async function loadAward(tenderId: string) {
  return db.award.findUnique({
    where: { tenderId },
    include: {
      authorizations: { include: { captures: true }, orderBy: { seq: "asc" } },
      milestones: { include: { capture: true }, orderBy: { seq: "asc" } },
      tender: true,
      bid: { include: { seller: true } },
    },
  });
}
type FullAward = NonNullable<Awaited<ReturnType<typeof loadAward>>>;

/** A capture PayPal accepted. A declined or denied one paid nothing. */
const accepted = <C extends { status: string }>(c: C | null | undefined): C | null => (c && !isFailedCapture(c.status) ? c : null);

/** The award in the shape the pure phase rules read. */
export function phaseState(award: Pick<FullAward, "holdCents" | "milestones" | "authorizations">) {
  const planned = milestoneAmounts(award.holdCents, award.milestones.map((m) => ({ name: m.name, pct: m.pct })));
  const milestones: MilestoneState[] = award.milestones.map((m, i) => ({ phase: m.phase, plannedCents: planned[i], paid: !!accepted(m.capture) }));
  const holds: HoldState[] = award.authorizations.map((a) => ({ phase: a.phase, paypalAuthId: a.paypalAuthId, status: a.status, expiresAt: a.expiresAt }));
  return { planned, milestones, holds };
}

/** The hold that pays a phase now: the newest live one. */
function liveHold(award: FullAward, phase: number) {
  return [...award.authorizations].reverse().find((a) => a.phase === phase && isLive(a));
}

/** The PayPal order for one hold. The first hold of a one-phase order itemizes goods and
 * shipping as before; any other hold is one line naming its phase. */
async function createHoldOrder(input: {
  award: { id: string; holdCents: number };
  tender: { id: string; title: string; currency: string; spec: unknown };
  payeeEmail: string;
  phase: number;
  phases: number;
  amountCents: number;
  breakdown?: { goodsCents: number; shippingCents: number };
  requestId: string;
}) {
  const spec = (input.tender.spec ?? {}) as { item?: string; quantity?: number };
  const what = `${spec.quantity ?? ""} ${spec.item ?? input.tender.title}`.trim();
  const items = input.breakdown
    ? [{ name: what.slice(0, 127), quantity: 1, unitAmountCents: input.breakdown.goodsCents }]
    : [{ name: `Phase ${input.phase} of ${input.phases}: ${what}`.slice(0, 127), quantity: 1, unitAmountCents: input.amountCents }];
  return pp().createAuthorizeOrder(
    {
      referenceId: input.tender.id,
      description: `${input.tender.title}, FairBid tender${input.phases > 1 ? `, phase ${input.phase} of ${input.phases}` : ""}`.slice(0, 127),
      currency: input.tender.currency,
      payeeEmail: input.payeeEmail,
      items,
      shippingCents: input.breakdown?.shippingCents ?? 0,
      taxCents: 0,
      handlingCents: 0,
    },
    input.requestId,
  );
}

/** Records the buyer's choice and creates the PayPal order for the first hold (intent
 * AUTHORIZE, seller as payee). Returns the order id for the PayPal button to approve. */
export async function startAward(tenderId: string, bidId: string, actor: string): Promise<{ orderId: string }> {
  if ((await statusOf(tenderId)) !== "SCORED") throw new StepError("Score the bids before awarding.");
  const t = await db.tender.findUniqueOrThrow({ where: { id: tenderId }, include: { award: { include: { authorizations: true } } } });
  if (t.award?.authorizations.some((a) => a.paypalAuthId)) throw new StepError("This tender is already awarded.");

  const bid = await db.bid.findUnique({ where: { id: bidId }, include: { lines: true, seller: true } });
  if (!bid || bid.tenderId !== tenderId) throw new StepError("That bid is not part of this tender.");
  const landed = landedCost(
    { goodsCents: lineOf(bid.lines, "goods"), shippingCents: lineOf(bid.lines, "shipping"), feesCents: lineOf(bid.lines, "fees") },
    await tariffFor(bid.hsCode, t.destinationCountry),
  );
  const total = holdCents(landed);
  const windowDays = Number((t.spec as { deliveryDays?: number })?.deliveryDays ?? 28);
  const plan = planMilestones(Math.min(MAX_DELIVERY_DAYS, Math.max(1, Math.round(windowDays))));
  const phases = phaseCount(plan);
  const planned = milestoneAmounts(total, plan);
  const firstHold = plan.reduce((s, m, i) => s + (m.phase === 1 ? planned[i] : 0), 0);

  // The PayPal button can ask for an order twice (a double click, a re-render). A recent
  // order for the same bid is reused, so the one the buyer approves is the one on record.
  const pending = t.award?.authorizations.find((a) => a.seq === 1);
  if (t.award && pending && t.award.bidId === bidId && Date.now() - pending.createdAt.getTime() < ORDER_REUSE_MS) {
    return { orderId: pending.paypalOrderId };
  }
  // An older attempt, or one for another bid, was never approved: it is replaced. Nothing was held.
  if (t.award) await db.award.delete({ where: { id: t.award.id } });
  const award = await db.award.create({
    data: {
      tenderId,
      bidId,
      holdCents: total,
      milestones: { create: plan.map((m, i) => ({ name: m.name, pct: m.pct, seq: i + 1, dueDay: m.dueDay, phase: m.phase })) },
    },
  });

  let order: { id: string; status: string };
  try {
    order = await createHoldOrder({
      award,
      tender: t,
      payeeEmail: bid.seller.paypalEmail,
      phase: 1,
      phases,
      amountCents: firstHold,
      breakdown: phases === 1 ? { goodsCents: landed.goodsCents, shippingCents: landed.shippingCents } : undefined,
      requestId: `award-${award.id}`,
    });
  } catch (e) {
    await db.award.delete({ where: { id: award.id } });
    throw e;
  }
  await db.authorization.create({ data: { awardId: award.id, phase: 1, seq: 1, paypalOrderId: order.id, amountCents: firstHold, status: order.status } });
  await appendEvent(tenderId, actor, "award.started", { bidId, holdCents: total, phases, firstHoldCents: firstHold, paypalOrderId: order.id });
  return { orderId: order.id };
}

/** Creates the PayPal order for the next hold: the next phase's, or a new one for a phase
 * whose hold lapsed before it was paid. Returns the order id for the PayPal button. */
export async function startHold(tenderId: string, actor: string): Promise<{ orderId: string }> {
  const status = await statusOf(tenderId);
  if (status !== "AWARDED" && status !== "IN_DELIVERY") throw new StepError("This tender has no order to hold money for.");
  const award = await loadAward(tenderId);
  if (!award) throw new StepError("This tender has no order to hold money for.");
  if (award.endedAt) throw new StepError("This order was ended. Nothing more is held or paid.");

  const { milestones, holds } = phaseState(award);
  const step = nextStep(milestones, holds);
  if (step.kind === "done") throw new StepError("Every step is paid. Nothing more to hold.");
  if (step.kind === "pay") throw new StepError("This phase is already held. Pay its next step instead.");

  // A recent unapproved order for the same phase and amount is reused; an older one is
  // dropped (nothing was held by it) and replaced.
  const unapproved = award.authorizations.filter((a) => !a.paypalAuthId && a.phase === step.phase);
  const reuse = unapproved.find((a) => a.amountCents === step.amountCents && Date.now() - a.createdAt.getTime() < ORDER_REUSE_MS);
  if (reuse) return { orderId: reuse.paypalOrderId };
  if (unapproved.length) await db.authorization.deleteMany({ where: { id: { in: unapproved.map((a) => a.id) } } });

  const seq = Math.max(0, ...award.authorizations.filter((a) => !unapproved.includes(a)).map((a) => a.seq)) + 1;
  const id = randomUUID();
  const order = await createHoldOrder({
    award,
    tender: award.tender,
    payeeEmail: award.bid.seller.paypalEmail,
    phase: step.phase,
    phases: phaseCount(award.milestones),
    amountCents: step.amountCents,
    requestId: `hold-${id}`,
  });
  await db.authorization.create({
    data: { id, awardId: award.id, phase: step.phase, seq, paypalOrderId: order.id, amountCents: step.amountCents, status: order.status },
  });
  await appendEvent(tenderId, actor, "hold.started", {
    phase: step.phase,
    phases: phaseCount(award.milestones),
    amountCents: step.amountCents,
    replacing: step.replacing,
    paypalOrderId: order.id,
  });
  return { orderId: order.id };
}

/** The buyer approved on PayPal: authorize the order, so the money is held. Used for
 * every hold, the first and each later one. Safe to repeat: a second call, or one
 * after a lost answer, records the same hold once. */
export async function authorizeAward(tenderId: string, orderId: string, actor: string) {
  const auth = await db.authorization.findUnique({ where: { paypalOrderId: orderId }, include: { award: true } });
  if (!auth || auth.award.tenderId !== tenderId) throw new StepError("That PayPal order is not part of this tender.");
  if (auth.paypalAuthId) return;
  if (auth.award.endedAt) throw new StepError("This order was ended. Nothing more is held.");

  // A later hold is only taken while its phase still needs one, so a stale PayPal window
  // can never hold money twice for the same phase.
  if (auth.seq > 1) {
    const award = (await loadAward(tenderId))!;
    const { milestones, holds } = phaseState(award);
    const step = nextStep(milestones, holds);
    if (step.kind !== "hold" || step.phase !== auth.phase) {
      throw new StepError("This phase no longer needs a hold. Nothing was held; reload the page.");
    }
  }

  type Hold = { id: string; status: string; expiration_time?: string };
  let a: Hold | undefined;
  try {
    const res = await pp().authorizeOrder(orderId, `authorize-${orderId}`);
    a = res.purchase_units?.[0]?.payments?.authorizations?.[0];
  } catch (error) {
    // An earlier attempt may have reached PayPal and lost its answer: the hold then
    // already exists on the order, and is read back instead of failing.
    const maybeDone = error instanceof PayPalUnreachableError || (error instanceof PayPalError && error.issue === "ORDER_ALREADY_AUTHORIZED");
    if (!maybeDone) {
      // Usually the buyer's money or card: nothing is reserved, the phase stays unheld,
      // and the seller's page keeps saying not to start it.
      if (error instanceof PayPalError) {
        await appendEvent(tenderId, actor, "hold.declined", { phase: auth.phase, amountCents: auth.amountCents, issue: error.issue ?? String(error.status) });
      }
      throw error;
    }
    const order = await pp().getOrder(orderId);
    a = order.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!a) throw error;
    log.warn("hold recovered from the order", { tenderId, orderId, paypalAuthId: a.id });
  }
  if (!a) throw new StepError("PayPal did not return a hold. Nothing was charged.");
  if (a.status === "DENIED" || a.status === "VOIDED") {
    await appendEvent(tenderId, actor, "hold.declined", { phase: auth.phase, amountCents: auth.amountCents, issue: a.status });
    throw new StepError("PayPal declined the hold, so nothing is reserved. Try another payment method in the PayPal window.");
  }

  const hold = a;
  const first = auth.seq === 1;
  const recorded = await db.$transaction(async (tx) => {
    // Only the first of two concurrent calls records the hold and moves the tender.
    const { count } = await tx.authorization.updateMany({
      where: { id: auth.id, paypalAuthId: null },
      data: { paypalAuthId: hold.id, status: hold.status, expiresAt: hold.expiration_time ? new Date(hold.expiration_time) : null },
    });
    if (count === 0) return false;
    if (first) await move(tx, tenderId, "SCORED", "AWARDED");
    return true;
  });
  if (!recorded) return;
  const phases = (await db.milestone.aggregate({ where: { awardId: auth.awardId }, _max: { phase: true } }))._max.phase ?? 1;
  const payload = { paypalAuthId: hold.id, amountCents: auth.amountCents, expiresAt: hold.expiration_time, phase: auth.phase, phases };
  await appendEvent(tenderId, actor, first ? "award.authorized" : "hold.authorized", payload);
}

/** PayPal issues that mean the hold itself is gone, not just this attempt. */
const DEAD_HOLD: Record<string, string> = {
  AUTHORIZATION_EXPIRED: "EXPIRED",
  AUTHORIZATION_VOIDED: "VOIDED",
  AUTHORIZATION_ALREADY_CAPTURED: "CAPTURED",
};

/** Pays the next milestone from its phase's hold. The last step of a phase is a final
 * capture, which closes that hold; the last step of the order may pay less than planned,
 * and the rest is released back to the buyer. */
export async function captureMilestone(
  tenderId: string,
  milestoneId: string,
  amountCents: number,
  actor: string,
): Promise<{ captureId: string; releasedCents: number; final: boolean; phaseDone: boolean }> {
  const status = await statusOf(tenderId);
  if (status !== "AWARDED" && status !== "IN_DELIVERY") throw new StepError("Nothing to pay on this tender.");
  const award = await loadAward(tenderId);
  if (!award) throw new StepError("Nothing to pay on this tender.");
  if (award.endedAt) throw new StepError("This order was ended. Nothing more is paid.");
  const { planned, milestones, holds } = phaseState(award);
  const lastIndex = award.milestones.length - 1;

  // A second click on a step that is already paid gets the same answer, not an error.
  const askedIndex = award.milestones.findIndex((m) => m.id === milestoneId);
  const askedCapture = askedIndex >= 0 ? accepted(award.milestones[askedIndex].capture) : null;
  if (askedCapture) {
    const hold = award.authorizations.find((a) => a.id === askedCapture.authorizationId);
    const lastOfPhase = isLastOfPhase(milestones, askedIndex);
    const usedOfHold = hold ? hold.captures.reduce((s, c) => s + (accepted(c)?.amountCents ?? 0), 0) : 0;
    return {
      captureId: askedCapture.paypalCaptureId ?? "",
      releasedCents: lastOfPhase && hold ? hold.amountCents - usedOfHold : 0,
      final: askedIndex === lastIndex,
      phaseDone: lastOfPhase && askedIndex !== lastIndex,
    };
  }

  const step = nextStep(milestones, holds);
  if (step.kind === "done") throw new StepError("Every step is paid.");
  if (award.milestones[step.index].id !== milestoneId) throw new StepError("Pay the steps in order.");
  if (step.kind === "hold") {
    throw new StepError(
      step.replacing
        ? "The PayPal hold for this phase has lapsed. Place a new hold for it first."
        : `Place the PayPal hold for phase ${step.phase} first.`,
    );
  }
  const index = step.index;
  const next = award.milestones[index];
  const hold = liveHold(award, step.phase)!;
  const lastOfPhase = isLastOfPhase(milestones, index);
  const final = index === lastIndex;
  const holdLeft = hold.amountCents - hold.captures.reduce((s, c) => s + (accepted(c)?.amountCents ?? 0), 0);

  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new StepError("Enter an amount above €0.");
  if (final ? amountCents > holdLeft : amountCents !== planned[index]) {
    throw new StepError(final ? `The most left to pay is ${formatEur(holdLeft, award.tender.currency)}.` : "This step pays the planned amount.");
  }

  // The request id is the milestone: a retry, a double click or a lost answer all get
  // PayPal's first answer back, so a step can never be paid twice. After a capture
  // PayPal refused, the id changes, so the next try is a new request and not the
  // refusal replayed.
  const failed = next.capture;
  const requestId = failed ? `capture-${next.id}-after-${failed.paypalCaptureId ?? failed.id}` : `capture-${next.id}`;
  let cap: { id: string; status: string; status_details?: { reason?: string } };
  try {
    cap = await pp().captureAuthorization({
      authorizationId: hold.paypalAuthId!,
      currency: award.tender.currency,
      amountCents,
      finalCapture: lastOfPhase,
      requestId,
    });
  } catch (error) {
    const dead = error instanceof PayPalError ? DEAD_HOLD[error.issue ?? ""] : undefined;
    if (dead) await db.authorization.update({ where: { id: hold.id }, data: { status: dead } });
    throw error;
  }

  const row = {
    authorizationId: hold.id,
    milestoneId: next.id,
    paypalCaptureId: cap.id,
    amountCents,
    finalCapture: lastOfPhase,
    status: cap.status,
    statusReason: cap.status_details?.reason ?? null,
    refundedCents: 0,
  };
  if (isFailedCapture(cap.status)) {
    // Recorded so the next try carries a new request id; the step stays open.
    await db.capture.upsert({ where: { milestoneId: next.id }, create: row, update: row }).catch(() => undefined);
    await appendEvent(tenderId, actor, "milestone.declined", { milestone: next.name, amountCents, paypalCaptureId: cap.id, reason: cap.status_details?.reason });
    throw new StepError(
      `PayPal declined this payment${reasonText(cap.status_details?.reason) ? `: ${reasonText(cap.status_details?.reason)}` : ""}. Nothing was paid; the hold is still in place.`,
    );
  }

  const releasedCents = lastOfPhase ? holdLeft - amountCents : 0;
  try {
    await db.$transaction(async (tx) => {
      // A refused capture from an earlier try is replaced by this one.
      await tx.capture.upsert({ where: { milestoneId: next.id }, create: row, update: row });
      await tx.milestone.update({ where: { id: next.id }, data: { status: "captured" } });
      if (status === "AWARDED") await move(tx, tenderId, "AWARDED", "IN_DELIVERY");
      if (lastOfPhase) await tx.authorization.update({ where: { id: hold.id }, data: { status: "CAPTURED" } });
      if (final) await move(tx, tenderId, "IN_DELIVERY", "COMPLETE");
    });
  } catch (error) {
    // A concurrent click already recorded this same capture: the step is paid, once.
    if (isUniqueViolation(error)) return { captureId: cap.id, releasedCents, final, phaseDone: lastOfPhase && !final };
    throw error;
  }
  await appendEvent(tenderId, actor, "milestone.paid", {
    milestone: next.name,
    amountCents,
    phase: step.phase,
    finalCapture: lastOfPhase,
    completesOrder: final,
    paypalCaptureId: cap.id,
    status: cap.status,
    reason: cap.status_details?.reason,
    releasedCents,
  });
  return { captureId: cap.id, releasedCents, final, phaseDone: lastOfPhase && !final };
}

/** The buyer stops the order between phases, when no hold is in place: nothing more is
 * held or paid, and what was never held is never charged. A live hold cannot be ended
 * this way, because PayPal does not let FairBid void a hold that pays the seller. */
export async function endOrder(tenderId: string, actor: string): Promise<{ neverChargedCents: number }> {
  const status = await statusOf(tenderId);
  if (status !== "AWARDED" && status !== "IN_DELIVERY") throw new StepError("This order cannot be ended now.");
  const award = await loadAward(tenderId);
  if (!award || award.endedAt) throw new StepError("This order cannot be ended now.");
  const { milestones, holds } = phaseState(award);
  const step = nextStep(milestones, holds);
  if (step.kind === "done") throw new StepError("Every step is already paid.");
  if (step.kind === "pay") {
    throw new StepError("A PayPal hold is in place for this phase. Pay its steps, or let it lapse; then the order can be ended.");
  }
  const paid = award.milestones.reduce((s, m) => s + (accepted(m.capture)?.amountCents ?? 0), 0);
  const neverChargedCents = award.holdCents - paid;
  await db.$transaction(async (tx) => {
    const { count } = await tx.award.updateMany({ where: { id: award.id, endedAt: null }, data: { endedAt: new Date() } });
    if (count !== 1) throw new StepError("This tender changed in the meantime. Reload the page.");
    if (status === "AWARDED") await move(tx, tenderId, "AWARDED", "IN_DELIVERY");
    await move(tx, tenderId, "IN_DELIVERY", "COMPLETE");
  });
  await appendEvent(tenderId, actor, "order.ended", { afterPhase: step.phase - 1, paidCents: paid, neverChargedCents });
  return { neverChargedCents };
}

// ── Sellers and buyers ───────────────────────────────────────────────────────

export interface BidInput {
  goodsCents: number;
  shippingCents: number;
  feesCents: number;
  leadTimeDays: number;
  notes: string;
  hsCode: string;
  photos: string[];
}

const PHOTO = /^data:image\/(jpeg|png|webp|svg\+xml)[;,]/;
const MAX_PHOTO_CHARS = 600_000;

export function checkPhotos(photos: unknown): string[] {
  if (!Array.isArray(photos)) return [];
  if (photos.length > 4) throw new StepError("Up to 4 photos.");
  for (const p of photos) {
    if (typeof p !== "string" || !PHOTO.test(p)) throw new StepError("Photos must be images.");
    if (p.length > MAX_PHOTO_CHARS) throw new StepError("One photo is too large. Try a smaller one.");
  }
  return photos as string[];
}

/** Seals a seller's bid. Replaces an earlier bid from the same seller while bidding is open. */
export async function submitBid(tenderId: string, sellerId: string, input: BidInput, actor: string) {
  const t = await db.tender.findUnique({ where: { id: tenderId } });
  if (!t || !canSubmitBid(t.status as TenderStatus, t.closesAt)) throw new StepError("Bidding on this tender is closed.");
  for (const [label, v] of [
    ["Price", input.goodsCents],
    ["Shipping", input.shippingCents],
    ["Fees", input.feesCents],
  ] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 100_000_000) throw new StepError(`${label} must be a whole amount in euros.`);
  }
  if (input.goodsCents === 0) throw new StepError("Enter your price.");
  if (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 1 || input.leadTimeDays > 365) {
    throw new StepError("Days to deliver must be between 1 and 365.");
  }
  if (!/^\d{4}(\.\d{2}){0,2}$/.test(input.hsCode)) throw new StepError("Confirm the customs code.");
  const photos = checkPhotos(input.photos);
  if (photos.length === 0) throw new StepError("Add at least one photo.");
  const notes = input.notes.trim().slice(0, 500);

  const sealedHash = createHash("sha256")
    .update(JSON.stringify({ sellerId, ...input, photos: photos.length, notes }))
    .digest("hex");
  const data = { leadTimeDays: input.leadTimeDays, notes, hsCode: input.hsCode, hsConfidence: 1, photos, sealedHash, submittedAt: new Date() };
  const lines = [
    { kind: "goods" as const, amountCents: input.goodsCents, source: "seller" },
    { kind: "shipping" as const, amountCents: input.shippingCents, source: "seller" },
    { kind: "fees" as const, amountCents: input.feesCents, source: "seller" },
  ];
  await db.$transaction(async (tx) => {
    const bid = await tx.bid.upsert({
      where: { tenderId_sellerId: { tenderId, sellerId } },
      create: { tenderId, sellerId, ...data, lines: { create: lines } },
      update: data,
    });
    await tx.bidLine.deleteMany({ where: { bidId: bid.id } });
    await tx.bidLine.createMany({ data: lines.map((l) => ({ ...l, bidId: bid.id })) });
  });
  // The hash only: the event log must not leak a sealed price.
  await appendEvent(tenderId, actor, "bid.sealed", { sellerId, sealedHash });
}

export interface TenderInput {
  /** "DE" or "US": sets the currency PayPal holds in and the tariff that prices bids. */
  destination: string;
  title: string;
  needText: string;
  item: string;
  quantity: number;
  budgetCents: number;
  deliveryDays: number;
  closesInDays: number;
  criteria: { name: string; weightPct: number; rubric: string }[];
  photos: string[];
}

export async function publishTender(input: TenderInput, actor: string): Promise<string> {
  const total = input.criteria.reduce((s, c) => s + c.weightPct, 0);
  if (total !== 100) throw new StepError("Weights must add up to 100%.");
  if (!Number.isInteger(input.deliveryDays) || input.deliveryDays < 1 || input.deliveryDays > MAX_DELIVERY_DAYS) {
    throw new StepError(`Delivery must be 1 to ${MAX_DELIVERY_DAYS} days. Over 28 days, PayPal holds the money one phase at a time.`);
  }
  if (!input.title.trim() || input.needText.trim().length < 20) throw new StepError("Describe what you need in a sentence or more.");
  // Money is integer cents in a 32-bit column, and the sandbox is not for fortunes.
  if (!Number.isInteger(input.budgetCents) || input.budgetCents < 5_000 || input.budgetCents > 100_000_000) {
    throw new StepError("Budget must be between 50 and 1,000,000.");
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100_000) {
    throw new StepError("Quantity must be between 1 and 100,000.");
  }
  const photos = checkPhotos(input.photos);
  const dest = DESTINATIONS.find((d) => d.country === input.destination);
  if (!dest) throw new StepError("Choose where the goods are delivered.");
  const tender = await db.tender.create({
    data: {
      title: input.title.trim().slice(0, 120),
      needText: input.needText.trim().slice(0, 2000),
      spec: { item: input.item, quantity: input.quantity, deliverTo: `${dest.city}, ${dest.country}`, deliveryDays: input.deliveryDays },
      budgetCents: input.budgetCents,
      currency: dest.currency,
      destinationCountry: dest.country,
      vatReclaimable: true,
      closesAt: new Date(Date.now() + input.closesInDays * 86_400_000),
      status: "DRAFT",
      buyerId: actor,
      photos,
      criteria: { create: input.criteria },
    },
  });
  await db.$transaction((tx) => move(tx, tender.id, "DRAFT", "OPEN"));
  await appendEvent(tender.id, actor, "tender.published", { criteria: input.criteria.map((c) => [c.name, c.weightPct]) });
  return tender.id;
}

/** Prisma's unique-constraint error: someone else wrote the same row first. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

const PAYPAL_MESSAGES: Record<string, string> = {
  PAYEE_ACCOUNT_INVALID: "PayPal does not know the seller's account. Set SELLER_D_PAYPAL_EMAIL to a sandbox business account and reset the demo.",
  PAYEE_ACCOUNT_RESTRICTED: "PayPal cannot pay the seller's account right now.",
  AUTHORIZATION_EXPIRED: "The PayPal hold has expired, so it can no longer pay the seller.",
  AUTHORIZATION_VOIDED: "PayPal has cancelled this hold, so it can no longer pay the seller.",
  PERMISSION_DENIED: "PayPal refused: this needs PayPal Multiparty.",
  ORDER_NOT_APPROVED: "The order was not approved on PayPal yet.",
  INSTRUMENT_DECLINED: "PayPal declined the buyer's payment method. Try another one in the PayPal window.",
  TRANSACTION_REFUSED: "PayPal refused the hold, so nothing is reserved. Try another payment method in the PayPal window.",
  PAYER_ACTION_REQUIRED: "PayPal needs the buyer to finish a step in the PayPal window first.",
  MAX_CAPTURE_AMOUNT_EXCEEDED: "That is more than the hold has left.",
};

/** Turns any failure into a message the screen can show. PayPal's own issue code is kept. */
export function toResult(error: unknown): { ok: false; error: string } {
  if (error instanceof StepError) return { ok: false, error: error.message };
  if (error instanceof PayPalUnreachableError) {
    log.error("PayPal unreachable", error);
    // The request may have arrived. Every money call carries an idempotency key, so a retry is safe.
    return { ok: false, error: "PayPal did not answer in time. Try again: a repeat can never pay twice." };
  }
  if (error instanceof PayPalError) {
    log.error("PayPal refused", error);
    return { ok: false, error: PAYPAL_MESSAGES[error.issue ?? ""] ?? `PayPal could not do this (${error.issue ?? error.status}).` };
  }
  if (isUniqueViolation(error) || (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2034")) {
    return { ok: false, error: "This tender changed in the meantime. Reload the page." };
  }
  log.error("step failed", error);
  // Not "nothing was charged": the failure may come after PayPal already paid. A retry
  // with the same idempotency key then records that payment instead of making a new one.
  return { ok: false, error: "Something went wrong on our side. Try again: a repeat can never pay twice." };
}
