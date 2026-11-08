// Sends a clarification to the chats of the sellers it was asked. Kept apart from the
// inbound side because the workflow calls this one, and the inbound side calls the workflow.

import { db } from "../db";
import { log } from "../log";
import { CHANNELS } from "./registry";
import { formatQuestion, type MessageChannel } from "./types";

/** Sends a clarification to every asked seller who linked a chat and has not answered yet.
 * Never throws: a chat that is down must not undo the question. */
export async function relayClarification(clarificationId: string): Promise<void> {
  try {
    const c = await db.clarification.findUnique({
      where: { id: clarificationId },
      include: { tender: { select: { title: true } }, replies: { select: { bidId: true } } },
    });
    if (!c) return;
    const sentTo = Array.isArray(c.sentTo) ? (c.sentTo as string[]) : [];
    const answered = new Set(c.replies.map((r) => r.bidId));
    const bids = await db.bid.findMany({ where: { tenderId: c.tenderId, sellerId: { in: sentTo } }, select: { id: true, sellerId: true } });
    const links = await db.channelLink.findMany({ where: { sellerId: { in: sentTo } } });
    const text = formatQuestion(c.tender.title, c.question);

    await Promise.allSettled(
      links.flatMap((link) => {
        const channel = CHANNELS[link.kind as MessageChannel];
        const bid = bids.find((b) => b.sellerId === link.sellerId);
        if (!channel?.configured() || !bid || answered.has(bid.id)) return [];
        return [
          (async () => {
            try {
              const { externalId } = await channel.send(link.address, text);
              await db.channelMessage.create({ data: { linkId: link.id, clarificationId, bidId: bid.id, externalId } });
            } catch (error) {
              log.warn("channel send failed", { kind: link.kind, clarificationId, error: error instanceof Error ? error.message : String(error) });
            }
          })(),
        ];
      }),
    );
  } catch (error) {
    log.error("channel relay failed", error, { clarificationId });
  }
}

