// Safe to repeat: rebuilds only the demo tender, and deletes nothing else.

import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { DEMO_BIDS, DEMO_CRITERIA, DEMO_SELLERS, DEMO_TARIFFS, DEMO_TENDER } from "./seed-data";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
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

  await db.tender.deleteMany({ where: { id: DEMO_TENDER.id } });
  await db.tender.create({
    data: {
      ...DEMO_TENDER,
      status: "OPEN",
      closesAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      criteria: { create: DEMO_CRITERIA },
      bids: {
        create: DEMO_BIDS.map((bid) => ({
          sellerId: bid.sellerId,
          leadTimeDays: bid.leadTimeDays,
          notes: bid.notes,
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

main()
  .then(() => console.log("Seeded the demo tender."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
