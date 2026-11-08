// End-to-end check of phased holds against a local database, with a stand-in PayPal
// that enforces PayPal's own rules (amount left on a hold, final capture closes it,
// expired holds refuse captures). Never touches the sandbox. Creates its own tenders
// and deletes them at the end.
//
//   npx tsx --env-file=.env scripts/phases-e2e.ts

import assert from "node:assert/strict";
import { verifyChain } from "../src/lib/audit";
import { getEvents } from "../src/lib/audit-store";
import { db } from "../src/lib/db";
import { PayPalError, type PayPalClient } from "../src/lib/paypal/client";
import { applyWebhook } from "../src/lib/paypal-sync";
import { getTenderView } from "../src/lib/tender-data";
import {
  authorizeAward,
  captureMilestone,
  closeBidding,
  endOrder,
  publishTender,
  StepError,
  startAward,
  startHold,
  submitBid,
  setPayPalClient,
} from "../src/lib/workflow";
import { DEMO_PHOTOS } from "../prisma/demo-photos";

const DAY = 86_400_000;
const DEPOSIT_OK = { depositAccepted: true };
const BUYER = "buyer-anna";

// ── A stand-in PayPal that keeps PayPal's rules ──────────────────────────────
type Auth = { id: string; amount: number; captured: number; closed: boolean; expiresAt: number };
const orders = new Map<string, { amount: number; auth?: Auth }>();
const auths = new Map<string, Auth>();
const byRequestId = new Map<string, unknown>();
let n = 0;
/** The buyer's PayPal account cannot cover the next hold. */
let brokeBuyer = false;
const once = <T>(requestId: string, make: () => T): T => {
  if (!byRequestId.has(requestId)) byRequestId.set(requestId, make());
  return byRequestId.get(requestId) as T;
};
const fake = {
  createAuthorizeOrder: async (input: { items: { unitAmountCents: number; quantity: number }[]; shippingCents: number }, requestId: string) =>
    once(requestId, () => {
      const id = `ORDER-${++n}`;
      orders.set(id, { amount: input.items.reduce((s, i) => s + i.unitAmountCents * i.quantity, 0) + input.shippingCents });
      return { id, status: "CREATED" };
    }),
  authorizeOrder: async (orderId: string) => {
    const o = orders.get(orderId)!;
    if (o.auth) throw new PayPalError("already", 422, "ORDER_ALREADY_AUTHORIZED");
    if (brokeBuyer) throw new PayPalError("declined", 422, "INSTRUMENT_DECLINED");
    const a: Auth = { id: `AUTH-${++n}`, amount: o.amount, captured: 0, closed: false, expiresAt: Date.now() + 29 * DAY };
    o.auth = a;
    auths.set(a.id, a);
    return { id: orderId, status: "COMPLETED", purchase_units: [{ payments: { authorizations: [{ id: a.id, status: "CREATED", expiration_time: new Date(a.expiresAt).toISOString() }] } }] };
  },
  getOrder: async (orderId: string) => {
    const a = orders.get(orderId)?.auth;
    return { id: orderId, status: "COMPLETED", purchase_units: [{ payments: { authorizations: a ? [{ id: a.id, status: "CREATED" }] : [] } }] };
  },
  captureAuthorization: async (input: { authorizationId: string; amountCents: number; finalCapture: boolean; requestId: string }) =>
    once(input.requestId, () => {
      const a = auths.get(input.authorizationId)!;
      if (a.expiresAt <= Date.now()) throw new PayPalError("expired", 422, "AUTHORIZATION_EXPIRED");
      if (a.closed) throw new PayPalError("closed", 422, "AUTHORIZATION_ALREADY_CAPTURED");
      if (a.captured + input.amountCents > a.amount) throw new PayPalError("too much", 422, "MAX_CAPTURE_AMOUNT_EXCEEDED");
      a.captured += input.amountCents;
      if (input.finalCapture) a.closed = true;
      return { id: `CAP-${++n}`, status: "COMPLETED" };
    }),
} as unknown as PayPalClient;
setPayPalClient(fake);

/** PayPal's clock moves on: the hold runs out. */
async function expire(paypalAuthId: string) {
  auths.get(paypalAuthId)!.expiresAt = Date.now() - 1000;
  await db.authorization.update({ where: { paypalAuthId }, data: { expiresAt: new Date(Date.now() - 1000) } });
}

async function rejects(p: Promise<unknown>, re: RegExp) {
  await assert.rejects(p, (e: unknown) => e instanceof StepError && re.test(e.message));
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
const created: string[] = [];
async function scoredTender(deliveryDays: number): Promise<{ tenderId: string; bidId: string }> {
  const tenderId = await publishTender(
    {
      destination: "DE",
      title: `E2E phases ${deliveryDays} days`,
      needText: "Three hundred hand-stamped batik napkins for a hotel group in Berlin.",
      item: "Batik napkins",
      quantity: 300,
      budgetCents: 300_000,
      deliveryDays,
      closesInDays: 3,
      criteria: [
        { name: "Delivered cost", weightPct: 60, rubric: "Lower is better." },
        { name: "Lead time", weightPct: 40, rubric: "Earlier is better." },
      ],
      photos: [],
    },
    BUYER,
  );
  created.push(tenderId);
  await submitBid(
    tenderId,
    "seller-d",
    { goodsCents: 228_900, shippingCents: 25_000, feesCents: 6_400, leadTimeDays: deliveryDays, notes: "Hand-stamped.", hsCode: "6302.51", photos: DEMO_PHOTOS["seller-d"]?.slice(0, 1) ?? [] },
    "seller-d",
  );
  // Scoring is tested elsewhere; this run is about money.
  await db.tender.update({ where: { id: tenderId }, data: { status: "SCORED" } });
  const bid = await db.bid.findFirstOrThrow({ where: { tenderId } });
  return { tenderId, bidId: bid.id };
}

const view = async (id: string) => (await getTenderView(id))!.award!;
const milestoneIds = async (id: string) => (await view(id)).milestones.map((m) => m.id);

async function main() {
  // 1. A two-month order: three phases, three holds.
  {
    const { tenderId, bidId } = await scoredTender(60);
    await rejects(startAward(tenderId, bidId, BUYER, { depositAccepted: false }), /non-refundable deposit/);
    const { orderId } = await startAward(tenderId, bidId, BUYER, DEPOSIT_OK);
    assert.equal((await startAward(tenderId, bidId, BUYER, DEPOSIT_OK)).orderId, orderId, "a second click reuses the order");
    await authorizeAward(tenderId, orderId, BUYER);
    await authorizeAward(tenderId, orderId, BUYER); // repeat-safe
    let a = await view(tenderId);
    assert.equal(a.phases, 3);
    assert.equal(a.holds.length, 1);
    const [m1, m2, m3] = a.milestones;
    assert.equal(a.holds[0].amountCents, m1.plannedCents, "phase 1 holds only its own step");
    assert.equal(a.heldCents, m1.plannedCents);
    assert.equal(a.notYetHeldCents, a.holdCents - m1.plannedCents);
    assert.deepEqual(a.next, { kind: "pay", phase: 1, milestoneId: m1.id });

    const r1 = await captureMilestone(tenderId, m1.id, m1.plannedCents, BUYER);
    assert.equal(r1.phaseDone, true);
    assert.equal(r1.final, false);
    assert.deepEqual(await captureMilestone(tenderId, m1.id, m1.plannedCents, BUYER), r1, "a second click gets the same answer");
    a = await view(tenderId);
    assert.equal(a.next.kind, "hold");
    assert.equal(a.next.kind === "hold" && a.next.amountCents, m2.plannedCents);
    assert.equal(a.heldCents, 0);
    await rejects(captureMilestone(tenderId, m2.id, m2.plannedCents, BUYER), /Place the PayPal hold for phase 2/);

    // Phase 2: the hold lapses before shipping, the buyer replaces it.
    const o2 = (await startHold(tenderId, BUYER)).orderId;
    assert.equal((await startHold(tenderId, BUYER)).orderId, o2, "a second click reuses the order");
    await authorizeAward(tenderId, o2, BUYER);
    await rejects(startHold(tenderId, BUYER), /already held/);
    await rejects(endOrder(tenderId, BUYER), /hold is in place/);
    await expire((await view(tenderId)).authorization!.paypalAuthId!);
    a = await view(tenderId);
    assert.deepEqual(a.next, { kind: "hold", phase: 2, milestoneId: m2.id, amountCents: m2.plannedCents, replacing: true });
    await rejects(captureMilestone(tenderId, m2.id, m2.plannedCents, BUYER), /lapsed/);
    const o2b = (await startHold(tenderId, BUYER)).orderId;
    assert.notEqual(o2b, o2);
    await authorizeAward(tenderId, o2b, BUYER);
    // Approving the lapsed hold's window again records nothing new.
    await authorizeAward(tenderId, o2, BUYER);
    assert.equal((await view(tenderId)).holds.length, 3);
    await captureMilestone(tenderId, m2.id, m2.plannedCents, BUYER);

    // A stale PayPal window for a phase that no longer needs a hold holds nothing.
    const o3 = (await startHold(tenderId, BUYER)).orderId;
    const stale = (await startHold(tenderId, BUYER)).orderId;
    assert.equal(stale, o3);
    await authorizeAward(tenderId, o3, BUYER);
    const extra = await db.authorization.create({
      data: { awardId: (await db.award.findUniqueOrThrow({ where: { tenderId } })).id, phase: 3, seq: 99, paypalOrderId: "ORDER-STALE", amountCents: 1, status: "CREATED" },
    });
    orders.set("ORDER-STALE", { amount: 1 });
    await rejects(authorizeAward(tenderId, "ORDER-STALE", BUYER), /no longer needs a hold/);
    assert.equal(orders.get("ORDER-STALE")!.auth, undefined, "PayPal was never asked to hold it");
    await db.authorization.delete({ where: { id: extra.id } });

    // Phase 3: the buyer pays €1 less on delivery; it is released.
    await authorizeAward(tenderId, o3, BUYER);
    await rejects(captureMilestone(tenderId, m3.id, m3.plannedCents + 1, BUYER), /most left to pay/);
    const r3 = await captureMilestone(tenderId, m3.id, m3.plannedCents - 100, BUYER);
    assert.equal(r3.final, true);
    assert.equal(r3.releasedCents, 100);
    a = await view(tenderId);
    const t = (await getTenderView(tenderId))!;
    assert.equal(t.status, "COMPLETE");
    assert.equal(a.complete, true);
    assert.equal(a.holds.length, 4, "three phases plus one replacement");
    assert.equal(a.paidCents, a.holdCents - 100);
    assert.equal(a.releasedCents, 100);
    assert.equal(a.heldCents, 0);
    assert.equal(a.notYetHeldCents, 0);

    // PayPal denies the final payment afterwards: the step and the tender reopen,
    // and the buyer is asked for a new hold for it.
    const finalCap = a.milestones[2].capture!.paypalCaptureId!;
    await applyWebhook({ id: "WH-E2E-1", event_type: "PAYMENT.CAPTURE.DENIED", resource: { id: finalCap, status: "DENIED" } });
    a = await view(tenderId);
    assert.equal((await getTenderView(tenderId))!.status, "IN_DELIVERY");
    assert.equal(a.complete, false);
    assert.equal(a.next.kind === "hold" && a.next.replacing, true);
    assert.equal(a.next.kind === "hold" && a.next.phase, 3);

    const check = verifyChain(await getEvents(tenderId));
    assert.equal(check.intact, true, "event chain intact");
    const started = (await getEvents(tenderId)).find((e) => e.kind === "award.started")!.payload as { deposit?: { cents: number; nonRefundable: boolean } };
    assert.equal(started.deposit?.nonRefundable, true, "the agreed deposit is on the record");
    assert.equal(started.deposit?.cents, m1.plannedCents);
    const kinds = (await getEvents(tenderId)).map((e) => e.kind);
    console.log("60 days, three phases, one lapse, final denied by webhook: ok");
    console.log("  events:", kinds.join(" "));
  }

  // 2. The buyer ends a phased order between phases.
  {
    const { tenderId, bidId } = await scoredTender(42);
    const { orderId } = await startAward(tenderId, bidId, BUYER, DEPOSIT_OK);
    await authorizeAward(tenderId, orderId, BUYER);
    const ids = await milestoneIds(tenderId);
    let a = await view(tenderId);
    assert.equal(a.phases, 2);
    // Phase 1 holds steps 1 and 2 (due within 28 days); step 3 is phase 2.
    await captureMilestone(tenderId, ids[0], a.milestones[0].plannedCents, BUYER);
    await rejects(endOrder(tenderId, BUYER), /hold is in place/);
    await captureMilestone(tenderId, ids[1], a.milestones[1].plannedCents, BUYER);

    // The buyer cannot cover phase 2: PayPal declines the hold. Nothing is reserved, the
    // step cannot be paid, the attempt is on the record, and the buyer can try again.
    brokeBuyer = true;
    const o2 = (await startHold(tenderId, BUYER)).orderId;
    await assert.rejects(authorizeAward(tenderId, o2, BUYER), (e: unknown) => e instanceof PayPalError && e.issue === "INSTRUMENT_DECLINED");
    a = await view(tenderId);
    assert.equal(a.next.kind, "hold");
    assert.equal(a.heldCents, 0);
    await rejects(captureMilestone(tenderId, ids[2], a.milestones[2].plannedCents, BUYER), /Place the PayPal hold for phase 2/);
    assert.ok((await getEvents(tenderId)).some((e) => e.kind === "hold.declined"), "the declined hold is logged");
    assert.equal((await startHold(tenderId, BUYER)).orderId, o2, "trying again reuses the same order");
    brokeBuyer = false;

    // The buyer gives up instead: the order ends between phases.
    const { neverChargedCents } = await endOrder(tenderId, BUYER);
    a = await view(tenderId);
    assert.equal(neverChargedCents, a.milestones[2].plannedCents);
    assert.equal(a.complete, true);
    assert.ok(a.endedAt);
    assert.equal(a.releasedCents, neverChargedCents);
    assert.equal((await getTenderView(tenderId))!.status, "COMPLETE");
    await rejects(startHold(tenderId, BUYER), /has no order|ended/);
    await rejects(endOrder(tenderId, BUYER), /cannot be ended/);
    console.log("42 days, phase 2 hold declined (no funds), then ended: ok");
  }

  // 3. An order of 28 days or less works as before: one hold, three captures.
  {
    const { tenderId, bidId } = await scoredTender(28);
    const { orderId } = await startAward(tenderId, bidId, BUYER, DEPOSIT_OK);
    await authorizeAward(tenderId, orderId, BUYER);
    let a = await view(tenderId);
    assert.equal(a.phases, 1);
    assert.equal(a.holds[0].amountCents, a.holdCents, "one hold for the whole order");
    for (const [i, m] of a.milestones.entries()) {
      const r = await captureMilestone(tenderId, m.id, i === 2 ? m.plannedCents - 6_200 : m.plannedCents, BUYER);
      assert.equal(r.phaseDone, false);
      if (i === 2) assert.equal(r.releasedCents, 6_200);
    }
    a = await view(tenderId);
    assert.equal(a.complete, true);
    assert.equal(a.releasedCents, 6_200);
    assert.equal(a.holds.length, 1);
    console.log("28 days, one hold: ok");
  }

  // 4. A 28-day order whose hold lapses mid-way gets a replacement for what is left.
  {
    const { tenderId, bidId } = await scoredTender(28);
    const { orderId } = await startAward(tenderId, bidId, BUYER, DEPOSIT_OK);
    await authorizeAward(tenderId, orderId, BUYER);
    let a = await view(tenderId);
    await captureMilestone(tenderId, a.milestones[0].id, a.milestones[0].plannedCents, BUYER);
    await expire(a.holds[0].paypalAuthId!);
    a = await view(tenderId);
    const left = a.milestones[1].plannedCents + a.milestones[2].plannedCents;
    assert.deepEqual(a.next, { kind: "hold", phase: 1, milestoneId: a.milestones[1].id, amountCents: left, replacing: true });
    const o = (await startHold(tenderId, BUYER)).orderId;
    await authorizeAward(tenderId, o, BUYER);
    await captureMilestone(tenderId, a.milestones[1].id, a.milestones[1].plannedCents, BUYER);
    await captureMilestone(tenderId, a.milestones[2].id, a.milestones[2].plannedCents, BUYER);
    a = await view(tenderId);
    assert.equal(a.complete, true);
    assert.equal(a.paidCents, a.holdCents);
    console.log("28 days, hold lapsed and replaced: ok");
  }

  // 5. Two clicks on the same step at once: one PayPal capture, one record, one event.
  {
    const { tenderId, bidId } = await scoredTender(28);
    const { orderId } = await startAward(tenderId, bidId, BUYER, DEPOSIT_OK);
    await authorizeAward(tenderId, orderId, BUYER);
    const m = (await view(tenderId)).milestones[0];
    const [r1, r2] = await Promise.all([
      captureMilestone(tenderId, m.id, m.plannedCents, BUYER).catch((e: Error) => e),
      captureMilestone(tenderId, m.id, m.plannedCents, BUYER).catch((e: Error) => e),
    ]);
    const ok = [r1, r2].filter((r) => !(r instanceof Error));
    assert.ok(ok.length >= 1, "at least one click succeeds");
    for (const r of ok) assert.equal((r as { captureId: string }).captureId, (ok[0] as { captureId: string }).captureId, "the same capture");
    const paidEvents = (await getEvents(tenderId)).filter((e) => e.kind === "milestone.paid");
    assert.equal(paidEvents.length, 1, "one payment event, not two");
    assert.equal((await view(tenderId)).paidCents, m.plannedCents);
    console.log("double click on a payment: one capture, one event: ok");
  }

  // 6. Bidding closes with no bids: the tender is cancelled, not left waiting for an award.
  {
    const tenderId = await publishTender(
      {
        destination: "DE",
        title: "E2E phases no bids",
        needText: "A tender nobody bids on, closed by the buyer at the deadline.",
        item: "Napkins",
        quantity: 10,
        budgetCents: 10_000,
        deliveryDays: 14,
        closesInDays: 1,
        criteria: [{ name: "Delivered cost", weightPct: 100, rubric: "Lower is better." }],
        photos: [],
      },
      BUYER,
    );
    created.push(tenderId);
    await closeBidding(tenderId, BUYER);
    assert.equal((await getTenderView(tenderId))!.status, "CANCELLED");
    console.log("closed with no bids, cancelled: ok");
  }

  // 7. Inputs a browser form would never send are refused on the server.
  {
    const base = {
      destination: "DE",
      title: "E2E phases bad input",
      needText: "Checking that the server refuses what the form never sends.",
      item: "Napkins",
      quantity: 10,
      budgetCents: 10_000,
      deliveryDays: 14,
      closesInDays: 3,
      criteria: [{ name: "Delivered cost", weightPct: 100, rubric: "" }],
      photos: [],
    };
    await rejects(publishTender({ ...base, closesInDays: -5 }, BUYER), /open 1 to 30 days/);
    await rejects(publishTender({ ...base, criteria: [{ name: "A", weightPct: 150, rubric: "" }, { name: "B", weightPct: -50, rubric: "" }] }, BUYER), /whole percent/);
    await rejects(publishTender({ ...base, deliveryDays: 400 }, BUYER), /1 to 180 days/);
    console.log("bad tender input refused: ok");
  }
}

main()
  .then(() => console.log("ALL OK"))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.webhookEvent.deleteMany({ where: { id: { startsWith: "WH-E2E-" } } });
    await db.tender.deleteMany({ where: { id: { in: created } } });
    await db.$disconnect();
  });
