import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
}

function getClient(): PrismaClient {
  if (globalThis.__prisma) return globalThis.__prisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  const adapter = new PrismaPg({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // Cached in every environment: `db` below resolves the client on each property
  // access, so without this each query would open a new connection pool.
  globalThis.__prisma = new PrismaClient({ adapter });
  return globalThis.__prisma;
}

// A Proxy so importing this file is always safe. `next build` loads every route's
// module graph, and CI has no database URL to give it.
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});
