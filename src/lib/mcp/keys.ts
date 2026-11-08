// Seller agents sign in to /api/mcp with a per-seller API key. Pure, so it is tested
// without a server. The keys come from MCP_SELLER_KEYS: "seller-a:key1,seller-b:key2".

import { createHash, timingSafeEqual } from "node:crypto";

export function parseSellerKeys(raw: string | undefined): Map<string, string> {
  const keys = new Map<string, string>(); // key -> sellerId
  for (const pair of (raw ?? "").split(",")) {
    const i = pair.indexOf(":");
    if (i < 1) continue;
    const sellerId = pair.slice(0, i).trim();
    const key = pair.slice(i + 1).trim();
    // Short keys are refused: they could be guessed.
    if (sellerId && key.length >= 24) keys.set(key, sellerId);
  }
  return keys;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** The seller a bearer token belongs to, or null. Compared in constant time. */
export function sellerForToken(authorization: string | null, keys: Map<string, string>): string | null {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return null;
  const given = digest(token);
  let found: string | null = null;
  for (const [key, sellerId] of keys) {
    if (timingSafeEqual(given, digest(key))) found = sellerId;
  }
  return found;
}
