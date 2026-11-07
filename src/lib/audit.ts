// Tamper-evident event log, chained per tender: each event's hash covers its
// content and the previous hash, so editing or removing an event breaks every
// hash after it. Pure; the database write lives in audit-store.ts.

import { createHash } from "node:crypto";

export const GENESIS_HASH = "0".repeat(64);

export interface EventContent {
  tenderId: string;
  seq: number;
  actor: string;
  kind: string;
  payload: unknown;
  at: string; // ISO
}

export interface ChainedEvent extends EventContent {
  prevHash: string;
  hash: string;
}

/** JSON with sorted keys, so the same content always hashes the same even if a
 * database returns keys in another order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashEvent(prevHash: string, content: EventContent): string {
  return createHash("sha256")
    .update(prevHash)
    .update(canonicalJson(content))
    .digest("hex");
}

export function chainEvent(prevHash: string, content: EventContent): ChainedEvent {
  return { ...content, prevHash, hash: hashEvent(prevHash, content) };
}

export type ChainCheck = { intact: true } | { intact: false; firstBrokenSeq: number };

/** Walks events in seq order. Cannot detect a truncated tail, since nothing
 * after the last event points back at it. */
export function verifyChain(events: readonly ChainedEvent[]): ChainCheck {
  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const event of events) {
    const { prevHash, hash, ...content } = event;
    if (event.seq !== expectedSeq || prevHash !== prev || hash !== hashEvent(prevHash, content)) {
      return { intact: false, firstBrokenSeq: event.seq };
    }
    prev = hash;
    expectedSeq += 1;
  }
  return { intact: true };
}
