// Rebuilds the demo tender from scratch. Shared by `npm run db:seed` and the
// Reset demo button, so both always start from the same state. Touches only the
// demo tender and the demo sellers; nothing else is deleted.

import { createHash } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client";
import { DEMO_BIDS, DEMO_CRITERIA, DEMO_SELLERS, DEMO_TARIFFS, DEMO_TENDER } from "../../prisma/seed-data";
import { DEMO_PHOTOS } from "../../prisma/demo-photos";
import { ensureDemoAccounts } from "./accounts";
import { ensureDemoHistory } from "./demo-history";

const HOUR = 60 * 60 * 1000;

// Bids arrive over a day; B and C come in 12 minutes apart, one of the
// coordination signals the review looks for.
const ARRIVAL_HOURS_AGO: Record<string, number> = {
  "seller-a": 30,
  "seller-b": 20,
  "seller-c": 19.8,
  "seller-d": 4,
};

export async function resetDemoTender(db: PrismaClient): Promise<void> {
  for (const seller of DEMO_SELLERS) {
    await db.seller.upsert({ where: { id: seller.id }, create: seller, update: seller });
  }

  for (const { hsPrefix, destination, effectiveFrom, ...rest } of DEMO_TARIFFS) {
    await db.tariffRate.upsert({
      where: { hsPrefix_destination_effectiveFrom: { hsPrefix, destination, effectiveFrom } },
      create: { hsPrefix, destination, effectiveFrom, ...rest },
      update: rest,
    });
  }
  // Earlier, finished tenders for the cash-flow history. Created once, never reset.
  await ensureDemoHistory(db);
  // Tenders from before accounts existed could only have been posted by the demo buyer.
  await db.tender.updateMany({ where: { buyerId: null }, data: { buyerId: "buyer-anna" } });
  await ensureDemoAccounts(db);

  const now = Date.now();
  await db.tender.deleteMany({ where: { id: DEMO_TENDER.id } });
  await db.tender.create({
    data: {
      ...DEMO_TENDER,
      status: "OPEN",
      closesAt: new Date(now + 3 * 24 * HOUR),
      criteria: { create: DEMO_CRITERIA },
      bids: {
        create: DEMO_BIDS.map((bid) => ({
          sellerId: bid.sellerId,
          leadTimeDays: bid.leadTimeDays,
          notes: bid.notes,
          hsCode: "6302.51",
          hsConfidence: bid.sellerId === "seller-a" ? 0.94 : 0.91,
          photos: DEMO_PHOTOS[bid.sellerId] ?? [],
          submittedAt: new Date(now - (ARRIVAL_HOURS_AGO[bid.sellerId] ?? 1) * HOUR),
          sealedHash: createHash("sha256").update(JSON.stringify(bid)).digest("hex"),
          lines: {
            create: [
              { kind: "goods" as const, amountCents: bid.goodsCents, source: "seller" },
              { kind: "shipping" as const, amountCents: bid.shippingCents, source: "seller" },
              { kind: "fees" as const, amountCents: bid.feesCents, source: "seller" },
            ],
          },
        })),
      },
    },
  });
}
