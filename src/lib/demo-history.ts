// Two finished sample tenders from earlier months, so the buyer's cash flow has a
// history to show. Illustrative only: the PayPal ids start with "SAMPLE-" and were
// never sent to PayPal. Created once; Reset demo leaves them alone.

import { createHash } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client";
import { GENESIS_HASH, chainEvent } from "./audit";

const CRITERIA = [
  { name: "Delivered cost", weightPct: 50, rubric: "Lowest delivered cost inside budget scores highest." },
  { name: "Quality", weightPct: 30, rubric: "Against the published specs." },
  { name: "Lead time", weightPct: 20, rubric: "Inside the delivery window, earlier scores higher." },
];

type Bid = { sellerId: string; goods: number; shipping: number; fees: number; days: number; notes: string };

interface Sample {
  id: string;
  title: string;
  needText: string;
  item: string;
  quantity: number;
  budgetCents: number;
  closedAt: string;
  winner: Bid;
  loser: Bid;
  authorizedAt: string;
  payments: { at: string; amountCents: number }[];
}

const SELLERS = [
  { id: "seller-lombok", name: "Lombok Clay Studio", country: "ID", paypalEmail: "sample-lombok@example.com" },
  { id: "seller-hanoi", name: "Hanoi Ceramics Trading", country: "VN", paypalEmail: "sample-hanoi@example.com" },
  { id: "seller-anyam", name: "Anyam Cirebon", country: "ID", paypalEmail: "sample-anyam@example.com" },
  { id: "seller-saigon", name: "Saigon Rattan Export", country: "VN", paypalEmail: "sample-saigon@example.com" },
];

const SAMPLES: Sample[] = [
  {
    id: "00000000-0000-4000-8000-0000000000a1",
    title: "120 ceramic soap dishes, Berlin",
    needText: "120 handmade ceramic soap dishes for our guest bathrooms, white glaze, within 4 weeks. Budget about 1,400 euros.",
    item: "Ceramic soap dishes",
    quantity: 120,
    budgetCents: 140_000,
    closedAt: "2026-09-04T16:00:00Z",
    winner: { sellerId: "seller-lombok", goods: 100_000, shipping: 18_000, fees: 4_000, days: 22, notes: "Hand-thrown stoneware, white glaze." },
    loser: { sellerId: "seller-hanoi", goods: 95_000, shipping: 30_000, fees: 5_000, days: 26, notes: "Glazed ceramic dishes, carton packed." },
    authorizedAt: "2026-09-07T09:10:00Z",
    payments: [
      { at: "2026-09-12T10:00:00Z", amountCents: 35_400 },
      { at: "2026-09-20T15:30:00Z", amountCents: 47_200 },
      { at: "2026-10-02T11:45:00Z", amountCents: 35_400 },
    ],
  },
  {
    id: "00000000-0000-4000-8000-0000000000a2",
    title: "60 rattan room baskets, Berlin",
    needText: "60 woven rattan baskets for our rooms, natural colour, within 4 weeks. Budget about 2,700 euros.",
    item: "Rattan room baskets",
    quantity: 60,
    budgetCents: 270_000,
    closedAt: "2026-10-03T16:00:00Z",
    winner: { sellerId: "seller-anyam", goods: 190_000, shipping: 34_000, fees: 6_000, days: 24, notes: "Hand-woven natural rattan, Cirebon." },
    loser: { sellerId: "seller-saigon", goods: 182_000, shipping: 48_000, fees: 9_000, days: 25, notes: "Rattan baskets, machine-assisted weave." },
    authorizedAt: "2026-10-06T08:20:00Z",
    payments: [
      { at: "2026-10-10T09:00:00Z", amountCents: 67_200 },
      { at: "2026-10-18T14:10:00Z", amountCents: 89_600 },
      // Two baskets arrived damaged, so the last step paid less; €40 was released.
      { at: "2026-10-30T10:20:00Z", amountCents: 63_200 },
    ],
  },
];

const MILESTONES = [
  { name: "Production started", pct: 30 },
  { name: "Shipped with tracking", pct: 40 },
  { name: "Delivered and confirmed", pct: 30 },
];

const lines = (b: Bid) => [
  { kind: "goods" as const, amountCents: b.goods, source: "seller" },
  { kind: "shipping" as const, amountCents: b.shipping, source: "seller" },
  { kind: "fees" as const, amountCents: b.fees, source: "seller" },
];

export async function ensureDemoHistory(db: PrismaClient): Promise<void> {
  for (const seller of SELLERS) {
    await db.seller.upsert({ where: { id: seller.id }, create: seller, update: seller });
  }
  for (const s of SAMPLES) {
    if (await db.tender.findUnique({ where: { id: s.id }, select: { id: true } })) continue;
    const hold = s.winner.goods + s.winner.shipping;
    const sample = (kind: string, n = 0) => `SAMPLE-${s.id.slice(-2).toUpperCase()}-${kind}${n || ""}`;

    const tender = await db.tender.create({
      data: {
        id: s.id,
        title: s.title,
        needText: s.needText,
        spec: { item: s.item, quantity: s.quantity, deliverTo: "Berlin, DE", deliveryDays: 28 },
        budgetCents: s.budgetCents,
        destinationCountry: "DE",
        closesAt: new Date(s.closedAt),
        createdAt: new Date(new Date(s.closedAt).getTime() - 7 * 86_400_000),
        status: "COMPLETE",
        buyerId: "buyer-anna",
        criteria: { create: CRITERIA },
        bids: {
          create: [s.winner, s.loser].map((b) => ({
            sellerId: b.sellerId,
            leadTimeDays: b.days,
            notes: b.notes,
            hsCode: "6912.00",
            sealedHash: createHash("sha256").update(JSON.stringify(b)).digest("hex"),
            submittedAt: new Date(new Date(s.closedAt).getTime() - 2 * 86_400_000),
            openedAt: new Date(s.closedAt),
            lines: { create: lines(b) },
          })),
        },
      },
      include: { bids: true },
    });
    const winnerBid = tender.bids.find((b) => b.sellerId === s.winner.sellerId)!;

    const award = await db.award.create({
      data: {
        tenderId: s.id,
        bidId: winnerBid.id,
        holdCents: hold,
        awardedAt: new Date(s.authorizedAt),
        milestones: { create: MILESTONES.map((m, i) => ({ ...m, seq: i + 1, status: "captured" as const })) },
      },
      include: { milestones: { orderBy: { seq: "asc" } } },
    });
    const auth = await db.authorization.create({
      data: {
        awardId: award.id,
        paypalOrderId: sample("ORDER"),
        paypalAuthId: sample("AUTH"),
        amountCents: hold,
        expiresAt: new Date(new Date(s.authorizedAt).getTime() + 29 * 86_400_000),
        status: "CAPTURED",
      },
    });
    for (const [i, p] of s.payments.entries()) {
      await db.capture.create({
        data: {
          authorizationId: auth.id,
          milestoneId: award.milestones[i].id,
          paypalCaptureId: sample("CAP", i + 1),
          amountCents: p.amountCents,
          finalCapture: i === s.payments.length - 1,
          status: "COMPLETED",
        },
      });
    }

    // The event log, chained exactly as audit-store.ts would have written it.
    const paid = s.payments.reduce((sum, p) => sum + p.amountCents, 0);
    const events: { at: string; actor: string; kind: string; payload: unknown }[] = [
      { at: tender.createdAt.toISOString(), actor: "buyer-anna", kind: "tender.published", payload: { sample: true } },
      { at: s.closedAt, actor: "system", kind: "tender.closed", payload: { bids: 2 } },
      { at: s.closedAt, actor: "buyer-anna", kind: "tender.scored", payload: { bids: 2 } },
      {
        at: s.authorizedAt,
        actor: "buyer-anna",
        kind: "award.authorized",
        payload: { paypalAuthId: sample("AUTH"), amountCents: hold },
      },
      ...s.payments.map((p, i) => ({
        at: p.at,
        actor: "buyer-anna",
        kind: "milestone.paid",
        payload: {
          milestone: MILESTONES[i].name,
          amountCents: p.amountCents,
          finalCapture: i === s.payments.length - 1,
          paypalCaptureId: sample("CAP", i + 1),
          releasedCents: i === s.payments.length - 1 ? hold - paid : 0,
        },
      })),
    ];
    let prev = GENESIS_HASH;
    for (const [i, e] of events.entries()) {
      // Hash the timestamp exactly as the database returns it (with milliseconds), or verifyChain fails.
      const chained = chainEvent(prev, { tenderId: s.id, seq: i + 1, ...e, at: new Date(e.at).toISOString() });
      await db.event.create({ data: { ...chained, payload: chained.payload as object, at: new Date(chained.at) } });
      prev = chained.hash;
    }
  }
}
