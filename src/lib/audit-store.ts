import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { GENESIS_HASH, chainEvent, type ChainedEvent } from "./audit";

/** Appends one event. The tender row lock stops two writers forking the chain.
 * A failed write is logged and never fails the action it records: recording work
 * must not undo work that already happened. */
export async function appendEvent(tenderId: string, actor: string, kind: string, payload: unknown): Promise<void> {
  try {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Tender" WHERE id = ${tenderId} FOR UPDATE`;
      const last = await tx.event.findFirst({ where: { tenderId }, orderBy: { seq: "desc" } });
      const event = chainEvent(last?.hash ?? GENESIS_HASH, {
        tenderId,
        seq: (last?.seq ?? 0) + 1,
        actor,
        kind,
        payload,
        at: new Date().toISOString(),
      });
      await tx.event.create({
        data: { ...event, payload: event.payload as Prisma.InputJsonValue, at: new Date(event.at) },
      });
    });
  } catch (error) {
    console.error(`event log write failed: tender=${tenderId} kind=${kind}`, error);
  }
}

export async function getEvents(tenderId: string): Promise<ChainedEvent[]> {
  const rows = await db.event.findMany({ where: { tenderId }, orderBy: { seq: "asc" } });
  return rows.map((row) => ({
    tenderId: row.tenderId,
    seq: row.seq,
    actor: row.actor,
    kind: row.kind,
    payload: row.payload,
    at: row.at.toISOString(),
    prevHash: row.prevHash,
    hash: row.hash,
  }));
}
