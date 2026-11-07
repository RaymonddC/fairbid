// Safe to repeat: rebuilds only the demo tender, and deletes nothing else.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { resetDemoTender } from "../src/lib/demo-reset";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

resetDemoTender(db)
  .then(() => console.log("Seeded the demo tender."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
