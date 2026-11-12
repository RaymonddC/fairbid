// Updates to a bidder's linked chat that need no reply, such as what their own agent did on a
// tender. Questions that need an answer go through relayClarification instead. Never throws:
// a chat that is down never blocks the agent.

import { db } from "../db";
import { log } from "../log";
import { CHANNELS } from "./registry";
import { tapData } from "./bot-text";
import { siteUrl } from "./site-url";
import type { Button, MessageChannel } from "./types";

export async function notifySeller(sellerId: string, text: string, buttons?: Button[][]): Promise<void> {
  try {
    const links = await db.channelLink.findMany({ where: { sellerId, kind: "telegram" } });
    await Promise.all(
      links.map(async (link) => {
        const channel = CHANNELS[link.kind as MessageChannel];
        if (!channel?.configured()) return;
        await channel.send(link.address, text, { expectReply: false, buttons });
      }),
    );
  } catch (error) {
    log.warn("bidder notify failed", { sellerId, error: error instanceof Error ? error.message : String(error) });
  }
}

/** The tender owner answered a bidder's question: the bidder who asked hears it in their chat. */
export async function notifySellerOfAnswer(sellerId: string, tenderId: string, tenderTitle: string, question: string, answer: string): Promise<void> {
  const url = siteUrl(`/tender/${tenderId}`);
  await notifySeller(
    sellerId,
    `FairBid: the tender owner answered your question on "${tenderTitle}", for every bidder:\n\nQ: ${question}\nA: ${answer}`,
    url ? [[{ text: "Open in FairBid", url }]] : undefined,
  );
}

/** A new tender opened: bidders with a linked chat and no agent switched on hear of it, with
 * buttons to let their agent bid or to ask. A bidder whose agent is on hears from the agent. */
export async function notifySellersOfNewTender(tenderId: string): Promise<void> {
  try {
    const t = await db.tender.findUnique({ where: { id: tenderId }, select: { title: true, status: true, spec: true, closesAt: true } });
    if (!t || t.status !== "OPEN") return;
    const links = await db.channelLink.findMany({ where: { kind: "telegram", seller: { agentOn: false } }, select: { sellerId: true } });
    const spec = (t.spec ?? {}) as { item?: string; quantity?: number };
    const url = siteUrl(`/tender/${tenderId}`);
    const text = `FairBid: a new tender is open: "${t.title}"${spec.quantity ? `, ${spec.quantity} x ${spec.item ?? "pieces"}` : ""}. Bidding closes ${t.closesAt.toISOString().slice(0, 10)}.`;
    const buttons: Button[][] = [
      [
        { text: "Let my agent bid", data: tapData.bidder("r", tenderId) },
        { text: "Ask a question", data: tapData.bidder("a", tenderId) },
      ],
      ...(url ? [[{ text: "Open in FairBid", url }]] : []),
    ];
    await Promise.all([...new Set(links.map((l) => l.sellerId))].map((id) => notifySeller(id, text, buttons)));
  } catch (error) {
    log.warn("new tender notify failed", { tenderId, error: error instanceof Error ? error.message : String(error) });
  }
}
