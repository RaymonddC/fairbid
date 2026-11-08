// Keys a seller makes for their own AI agent, from their dashboard. The key is shown once;
// only its sha256 is stored, so a database leak gives nobody a working key. The four demo
// agents keep their keys in MCP_SELLER_KEYS (keys.ts); both kinds open the same endpoint.

import { db } from "../db";
import { StepError } from "../workflow";
import { KEY_PREFIX, bearerToken, hashKey, newKey, parseSellerKeys, sellerForToken } from "./keys";

export const MAX_ACTIVE_KEYS = 5;
/** lastUsedAt is a hint for the seller, not an audit trail: write it at most this often. */
const TOUCH_EVERY_MS = 5 * 60_000;

export type AgentKeyView = { id: string; label: string; prefix: string; createdAt: string; lastUsedAt: string | null };

export async function listAgentKeys(sellerId: string): Promise<AgentKeyView[]> {
  const rows = await db.agentKey.findMany({ where: { sellerId, revokedAt: null }, orderBy: { createdAt: "desc" } });
  return rows.map((k) => ({
    id: k.id,
    label: k.label,
    prefix: k.prefix,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
  }));
}

/** Makes a key for the seller and returns it once. The caller must never log or store it. */
export async function createAgentKey(
  sellerId: string,
  label: unknown,
  { shared = false }: { shared?: boolean } = {},
): Promise<{ key: string; view: AgentKeyView }> {
  const name = typeof label === "string" ? label.trim().slice(0, 60) : "";
  if (!name) throw new StepError("Name the key after the agent that will use it, for example \"Claude on my laptop\".");
  const active = await db.agentKey.findMany({ where: { sellerId, revokedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (active.length >= MAX_ACTIVE_KEYS) {
    if (!shared) throw new StepError(`You have ${MAX_ACTIVE_KEYS} keys. Revoke one you no longer use first.`);
    // The shared demo seller is used by every visitor: the oldest key gives way, so it never jams.
    await db.agentKey.update({ where: { id: active[0].id }, data: { revokedAt: new Date() } });
  }
  const { key, hash, prefix } = newKey();
  const row = await db.agentKey.create({ data: { sellerId, keyHash: hash, prefix, label: name } });
  return { key, view: { id: row.id, label: row.label, prefix: row.prefix, createdAt: row.createdAt.toISOString(), lastUsedAt: null } };
}

/** Revokes one of the seller's own keys. Another seller's key id is treated as not found. */
export async function revokeAgentKey(sellerId: string, id: unknown): Promise<void> {
  if (typeof id !== "string") throw new StepError("Key not found.");
  const r = await db.agentKey.updateMany({ where: { id, sellerId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (r.count === 0) throw new StepError("Key not found, or already revoked.");
}

/** The seller an Authorization header belongs to: a demo agent's key, or a live key a seller made. */
export async function sellerForAuthorization(authorization: string | null): Promise<string | null> {
  const demo = sellerForToken(authorization, parseSellerKeys(process.env.MCP_SELLER_KEYS));
  if (demo) return demo;
  const token = bearerToken(authorization);
  if (!token?.startsWith(KEY_PREFIX)) return null;
  // A lookup by the key's hash: the database never sees the key itself.
  const row = await db.agentKey.findUnique({ where: { keyHash: hashKey(token) } });
  if (!row || row.revokedAt) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    await db.agentKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  return row.sellerId;
}
