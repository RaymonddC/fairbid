// Six open tenders from the demo buyer, so sellers and their agents always have more than
// one tender to bid on, ask about and skip. Illustrative, like the demo tender: fixed ids,
// owned by the demo buyer, and Reset demo reopens them for another week with no bids.
// Real tenders are never touched.

import type { PrismaClient } from "../generated/prisma/client";
import { GENESIS_HASH, chainEvent } from "./audit";

const HOUR = 3_600_000;
const OPEN_DAYS = 7;

const criteria = (windowDays: number, judged: { name: string; rubric: string }) => [
  { name: "Delivered cost", weightPct: 40, rubric: "Lowest delivered cost inside budget scores highest." },
  { name: judged.name, weightPct: 25, rubric: judged.rubric },
  { name: "Lead time", weightPct: 20, rubric: `Inside the ${windowDays}-day window, earlier scores higher.` },
  { name: "Completeness", weightPct: 15, rubric: "All fields filled and customs code confirmed." },
];

interface OpenSample {
  id: string;
  title: string;
  needText: string;
  item: string;
  quantity: number;
  deliverTo: string;
  country: string;
  deliveryDays: number;
  budgetCents: number;
  judged: { name: string; rubric: string };
}

export const DEMO_OPEN_TENDERS: OpenSample[] = [
  {
    id: "00000000-0000-4000-8000-0000000000b1",
    title: "200 hand-drawn batik table runners, Hamburg",
    needText:
      "We need 200 hand-drawn batik table runners for our hotel restaurants in Hamburg, about 180 x 40 cm, indigo and brown. Budget around 4,000 euros before VAT, delivered within 5 weeks. Real hand-drawn (tulis) batik, not printed.",
    item: "Hand-drawn batik table runners",
    quantity: 200,
    deliverTo: "Hamburg, DE",
    country: "DE",
    deliveryDays: 35,
    budgetCents: 400_000,
    judged: { name: "Handmade proof", rubric: "Stated technique (tulis, hand-drawn), shown in photos." },
  },
  {
    id: "00000000-0000-4000-8000-0000000000b2",
    title: "500 hand-stamped batik scarves, Cologne",
    needText:
      "Looking for 500 batik scarves, cotton, 180 x 50 cm, hand-stamped, for our museum shop in Cologne. Budget about 6,000 euros before VAT, needed within 6 weeks.",
    item: "Hand-stamped cotton batik scarves",
    quantity: 500,
    deliverTo: "Cologne, DE",
    country: "DE",
    deliveryDays: 42,
    budgetCents: 600_000,
    judged: { name: "Handmade proof", rubric: "Stated technique (cap, hand-stamped), shown in photos." },
  },
  {
    id: "00000000-0000-4000-8000-0000000000b3",
    title: "120 handmade ceramic coffee mugs, Frankfurt",
    needText:
      "We need 120 handmade ceramic coffee mugs, 300 ml, glazed in earthy colours, for our café chain in Frankfurt. Budget around 1,500 euros before VAT, delivered within 4 weeks. Dishwasher safe.",
    item: "Handmade ceramic coffee mugs, 300 ml",
    quantity: 120,
    deliverTo: "Frankfurt, DE",
    country: "DE",
    deliveryDays: 28,
    budgetCents: 150_000,
    judged: { name: "Quality", rubric: "Glaze, food safety and dishwasher safety as stated." },
  },
  {
    id: "00000000-0000-4000-8000-0000000000b4",
    title: "80 woven rattan lampshades, Düsseldorf",
    needText:
      "Our boutique hotel in Düsseldorf needs 80 woven rattan lampshades, about 40 cm wide, natural colour, handmade. Budget around 2,400 euros before VAT, within 5 weeks.",
    item: "Woven rattan lampshades, 40 cm",
    quantity: 80,
    deliverTo: "Düsseldorf, DE",
    country: "DE",
    deliveryDays: 35,
    budgetCents: 240_000,
    judged: { name: "Handmade proof", rubric: "Hand-woven, shown in photos." },
  },
  {
    id: "00000000-0000-4000-8000-0000000000b5",
    title: "300 kg green arabica coffee beans, New York",
    needText:
      "We want 300 kg of single-origin green coffee beans, arabica, washed process, for our roastery in New York. Budget around 3,900 US dollars, delivered within 6 weeks.",
    item: "Green arabica coffee beans, washed (kg)",
    quantity: 300,
    deliverTo: "New York, US",
    country: "US",
    deliveryDays: 42,
    budgetCents: 390_000,
    judged: { name: "Quality", rubric: "Origin, process and grade as stated." },
  },
  {
    id: "00000000-0000-4000-8000-0000000000b6",
    title: "150 hand-carved teak serving boards, Munich",
    needText:
      "We need 150 hand-carved teak serving boards, about 40 x 25 cm, food safe finish, for a homeware shop in Munich. Budget about 2,250 euros before VAT, within 4 weeks.",
    item: "Hand-carved teak serving boards",
    quantity: 150,
    deliverTo: "Munich, DE",
    country: "DE",
    deliveryDays: 28,
    budgetCents: 225_000,
    judged: { name: "Handmade proof", rubric: "Hand-carved, food-safe finish stated." },
  },
];

/** Recreates the open demo tenders: open for another week, no bids, questions or events
 * but the one that publishes it. Only these fixed ids are ever deleted. */
export async function ensureDemoOpenTenders(db: PrismaClient): Promise<void> {
  const now = Date.now();
  await db.tender.deleteMany({ where: { id: { in: DEMO_OPEN_TENDERS.map((t) => t.id) } } });
  for (const [i, t] of DEMO_OPEN_TENDERS.entries()) {
    // Staggered a little, so the board does not show six tenders closing at the same minute.
    const publishedAt = new Date(now - (i + 1) * 3 * HOUR);
    const items = criteria(t.deliveryDays, t.judged);
    await db.tender.create({
      data: {
        id: t.id,
        title: t.title,
        needText: t.needText,
        spec: { item: t.item, quantity: t.quantity, deliverTo: t.deliverTo, deliveryDays: t.deliveryDays },
        budgetCents: t.budgetCents,
        currency: t.country === "US" ? "USD" : "EUR",
        destinationCountry: t.country,
        vatReclaimable: t.country !== "US",
        buyerId: "buyer-anna",
        status: "OPEN",
        createdAt: publishedAt,
        closesAt: new Date(publishedAt.getTime() + OPEN_DAYS * 24 * HOUR),
        criteria: { create: items },
      },
    });
    const chained = chainEvent(GENESIS_HASH, {
      tenderId: t.id,
      seq: 1,
      actor: "buyer-anna",
      kind: "tender.published",
      payload: { criteria: items.map((c) => [c.name, c.weightPct]) },
      at: publishedAt.toISOString(),
    });
    await db.event.create({ data: { ...chained, payload: chained.payload as object, at: new Date(chained.at) } });
  }
}
