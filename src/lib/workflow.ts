// Server-side steps of a tender, called by the server actions. Each one checks
// the tender's state, moves it with assertTransition, and records an event.
// Identity always comes from the session, never from an argument.

import { createHash } from "node:crypto";
import type { Prisma } from "../generated/prisma/client";
import { appendEvent } from "./audit-store";
import { db } from "./db";
import { holdCents, landedCost } from "./landed";
import { createPayPalClient, loadConfig, PayPalError, type PayPalClient } from "./paypal/client";
import { DEMO_QUESTIONS, DEMO_REVIEWED_SCORES, UNREVIEWED } from "./review-fixture";
import {
  completenessScore,
  costScore,
  criterionKind,
  findCoordinatedPairs,
  formatEur,
  leadTimeScore,
} from "./scoring";
import { DEFAULT_MILESTONES, assertTransition, canSubmitBid, milestoneAmounts, type TenderStatus } from "./tender";
import { tariffFor } from "./tender-data";
import { DEMO_TENDER_ID } from "../../prisma/seed-data";
import { DESTINATIONS } from "./format";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export class StepError extends Error {}

let paypal: PayPalClient | null = null;
const pp = () => (paypal ??= createPayPalClient(loadConfig()));

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
  const bids = await db.bid.findMany({ where: { tenderId }, include: { lines: true } });
  const { currency } = await db.tender.findUniqueOrThrow({ where: { id: tenderId }, select: { currency: true } });
  const now = new Date();

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
  const questions = tenderId === DEMO_TENDER_ID ? DEMO_QUESTIONS : [];
  const bidOf = (sellerId: string) => bids.find((b) => b.sellerId === sellerId);
  // The scripted review ran two hours before the demo close, so its seeded replies are already in the past.
  const asked = new Date(now.getTime() - 2 * 60 * 60_000);

  await db.$transaction(async (tx) => {
    await move(tx, tenderId, "OPEN", "CLOSED");
    await tx.tender.update({ where: { id: tenderId }, data: { closesAt: now } });
    await tx.bid.updateMany({ where: { tenderId }, data: { openedAt: now } });
    await move(tx, tenderId, "CLOSED", "REVIEWING");

    for (const p of pairs) {
      await tx.flag.create({
        data: {
          bidId: p.bidId,
          pairedBidId: p.pairedBidId,
          kind: "price_and_text",
          similarity: p.similarity,
          evidence: p.evidence,
          reason: "These two bids look coordinated. A person should look before awarding.",
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
                : tenderId === DEMO_TENDER_ID
                  ? (DEMO_REVIEWED_SCORES[p.bid.sellerId] ?? UNREVIEWED)
                  : UNREVIEWED;
        await tx.score.upsert({
          where: { bidId_criterionId: { bidId: p.bid.id, criterionId: c.id } },
          create: { bidId: p.bid.id, criterionId: c.id, score: s.score, reason: s.reason },
          update: { score: s.score, reason: s.reason },
        });
      }
    }
    await move(tx, tenderId, "PRICED", "SCORED");
  });
  await appendEvent(tenderId, actor, "tender.scored", { bids: priced.length });
}

// ── Award, hold and pay ──────────────────────────────────────────────────────

/** Records the buyer's choice and creates the PayPal order (intent AUTHORIZE,
 * seller as payee). Returns the order id for the PayPal button to approve. */
export async function startAward(tenderId: string, bidId: string, actor: string): Promise<{ orderId: string }> {
  if ((await statusOf(tenderId)) !== "SCORED") throw new StepError("Score the bids before awarding.");
  const t = await db.tender.findUniqueOrThrow({ where: { id: tenderId }, include: { award: { include: { authorization: true } } } });
  if (t.award?.authorization?.paypalAuthId) throw new StepError("This tender is already awarded.");

  const bid = await db.bid.findUnique({ where: { id: bidId }, include: { lines: true, seller: true } });
  if (!bid || bid.tenderId !== tenderId) throw new StepError("That bid is not part of this tender.");
  const landed = landedCost(
    { goodsCents: lineOf(bid.lines, "goods"), shippingCents: lineOf(bid.lines, "shipping"), feesCents: lineOf(bid.lines, "fees") },
    await tariffFor(bid.hsCode, t.destinationCountry),
  );
  const hold = holdCents(landed);
  const spec = (t.spec ?? {}) as { item?: string; quantity?: number };

  // An earlier attempt the buyer never approved is replaced, not reused.
  if (t.award) await db.award.delete({ where: { id: t.award.id } });
  const award = await db.award.create({
    data: {
      tenderId,
      bidId,
      holdCents: hold,
      milestones: { create: DEFAULT_MILESTONES.map((m, i) => ({ name: m.name, pct: m.pct, seq: i + 1 })) },
    },
  });

  let order: { id: string; status: string };
  try {
    order = await pp().createAuthorizeOrder(
      {
        referenceId: tenderId,
        description: `${t.title}, FairBid tender`.slice(0, 127),
        currency: t.currency,
        payeeEmail: bid.seller.paypalEmail,
        items: [{ name: `${spec.quantity ?? ""} ${spec.item ?? t.title}`.trim().slice(0, 127), quantity: 1, unitAmountCents: landed.goodsCents }],
        shippingCents: landed.shippingCents,
        taxCents: 0,
        handlingCents: 0,
      },
      `award-${award.id}`,
    );
  } catch (e) {
    await db.award.delete({ where: { id: award.id } });
    throw e;
  }
  await db.authorization.create({ data: { awardId: award.id, paypalOrderId: order.id, amountCents: hold, status: order.status } });
  await appendEvent(tenderId, actor, "award.started", { bidId, holdCents: hold, paypalOrderId: order.id });
  return { orderId: order.id };
}

/** The buyer approved on PayPal: authorize the order, so the money is held. */
export async function authorizeAward(tenderId: string, orderId: string, actor: string) {
  const auth = await db.authorization.findUnique({ where: { paypalOrderId: orderId }, include: { award: true } });
  if (!auth || auth.award.tenderId !== tenderId) throw new StepError("That PayPal order is not part of this tender.");
  if (auth.paypalAuthId) return;

  const res = await pp().authorizeOrder(orderId, `authorize-${orderId}`);
  const a = res.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!a) throw new StepError("PayPal did not return a hold. Nothing was charged.");
  await db.$transaction(async (tx) => {
    await tx.authorization.update({
      where: { id: auth.id },
      data: { paypalAuthId: a.id, status: a.status, expiresAt: a.expiration_time ? new Date(a.expiration_time) : null },
    });
    await move(tx, tenderId, "SCORED", "AWARDED");
  });
  await appendEvent(tenderId, actor, "award.authorized", { paypalAuthId: a.id, amountCents: auth.amountCents, expiresAt: a.expiration_time });
}

/** Pays the next milestone from the hold. The last one is a final capture, which
 * releases whatever is left back to the buyer; it may be less than planned. */
export async function captureMilestone(
  tenderId: string,
  milestoneId: string,
  amountCents: number,
  actor: string,
): Promise<{ captureId: string; releasedCents: number; final: boolean }> {
  const status = await statusOf(tenderId);
  if (status !== "AWARDED" && status !== "IN_DELIVERY") throw new StepError("Nothing to pay on this tender.");
  const award = await db.award.findUniqueOrThrow({
    where: { tenderId },
    include: { authorization: true, milestones: { include: { capture: true }, orderBy: { seq: "asc" } }, tender: true },
  });
  const auth = award.authorization;
  if (!auth?.paypalAuthId) throw new StepError("The hold is not in place yet.");

  const next = award.milestones.find((m) => !m.capture);
  if (!next || next.id !== milestoneId) throw new StepError("Pay the steps in order.");
  const planned = milestoneAmounts(award.holdCents, award.milestones.map((m) => ({ name: m.name, pct: m.pct })));
  const index = award.milestones.indexOf(next);
  const final = index === award.milestones.length - 1;
  const paid = award.milestones.reduce((s, m) => s + (m.capture?.amountCents ?? 0), 0);
  const remaining = award.holdCents - paid;

  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new StepError("Enter an amount above €0.");
  if (final ? amountCents > remaining : amountCents !== planned[index]) {
    throw new StepError(final ? `The most left to pay is ${formatEur(remaining, award.tender.currency)}.` : "This step pays the planned amount.");
  }

  const cap = await pp().captureAuthorization({
    authorizationId: auth.paypalAuthId,
    currency: award.tender.currency,
    amountCents,
    finalCapture: final,
    requestId: `capture-${next.id}`,
  });

  await db.$transaction(async (tx) => {
    await tx.capture.create({
      data: {
        authorizationId: auth.id,
        milestoneId: next.id,
        paypalCaptureId: cap.id,
        amountCents,
        finalCapture: final,
        status: cap.status,
      },
    });
    await tx.milestone.update({ where: { id: next.id }, data: { status: "captured" } });
    if (status === "AWARDED") await move(tx, tenderId, "AWARDED", "IN_DELIVERY");
    if (final) {
      await move(tx, tenderId, "IN_DELIVERY", "COMPLETE");
      await tx.authorization.update({ where: { id: auth.id }, data: { status: "CAPTURED" } });
    }
  });
  await appendEvent(tenderId, actor, "milestone.paid", {
    milestone: next.name,
    amountCents,
    finalCapture: final,
    paypalCaptureId: cap.id,
    releasedCents: final ? remaining - amountCents : 0,
  });
  return { captureId: cap.id, releasedCents: final ? remaining - amountCents : 0, final };
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
  if (input.deliveryDays < 1 || input.deliveryDays > 28) {
    throw new StepError("Delivery must fit inside PayPal's 29-day hold: 28 days at most.");
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
      photos,
      criteria: { create: input.criteria },
    },
  });
  await db.$transaction((tx) => move(tx, tender.id, "DRAFT", "OPEN"));
  await appendEvent(tender.id, actor, "tender.published", { criteria: input.criteria.map((c) => [c.name, c.weightPct]) });
  return tender.id;
}

/** Turns any failure into a message the screen can show. PayPal's own issue code is kept. */
export function toResult(error: unknown): { ok: false; error: string } {
  if (error instanceof StepError) return { ok: false, error: error.message };
  if (error instanceof PayPalError) {
    console.error("PayPal", error.status, error.issue, error.debugId, error.message);
    const known: Record<string, string> = {
      PAYEE_ACCOUNT_INVALID: "PayPal does not know the seller's account. Set SELLER_D_PAYPAL_EMAIL to a sandbox business account and reset the demo.",
      PAYEE_ACCOUNT_RESTRICTED: "PayPal cannot pay the seller's account right now.",
      AUTHORIZATION_EXPIRED: "The PayPal hold has expired.",
      PERMISSION_DENIED: "PayPal refused: this needs PayPal Multiparty.",
      ORDER_NOT_APPROVED: "The order was not approved on PayPal yet.",
      INSTRUMENT_DECLINED: "PayPal declined the buyer's payment method. Try another one in the PayPal window.",
    };
    return { ok: false, error: known[error.issue ?? ""] ?? `PayPal could not do this (${error.issue ?? error.status}).` };
  }
  console.error(error);
  return { ok: false, error: "Something went wrong on our side. Nothing was charged. Try again." };
}
