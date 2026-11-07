// Email and password accounts. The two demo accounts are seeded with a published
// password, so judges can try either way of signing in. Server only.

import type { PrismaClient } from "../generated/prisma/client";
import { DEMO_USERS, type User } from "./auth";
import { hashPassword } from "./password";

/** Public on purpose: it is printed on the login page for judges. Sandbox data only. */
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "fairbid-demo";

export const DEMO_EMAILS: Record<string, string> = {
  "buyer-anna": "anna@fairbid.demo",
  "seller-sari": "sari@fairbid.demo",
};

/** Creates the demo accounts if missing, and resets their password to DEMO_PASSWORD. */
export async function ensureDemoAccounts(db: PrismaClient): Promise<void> {
  for (const u of DEMO_USERS) {
    const email = DEMO_EMAILS[u.id];
    if (!email) continue;
    const data = { email, name: u.name, role: u.role, sellerId: u.sellerId ?? null, detail: u.detail, passwordHash: hashPassword(DEMO_PASSWORD) };
    await db.account.upsert({ where: { id: u.id }, create: { id: u.id, ...data }, update: data });
  }
}

export function accountToUser(a: { id: string; name: string; role: string; sellerId: string | null; detail: string }): User {
  return { id: a.id, name: a.name, role: a.role === "seller" ? "seller" : "buyer", sellerId: a.sellerId ?? undefined, detail: a.detail };
}
