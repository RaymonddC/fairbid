// Updates to a bidder's linked chat that need no reply, such as what their own agent did on a
// tender. Questions that need an answer go through relayClarification instead. Never throws:
// a chat that is down never blocks the agent.

import { db } from "../db";
import { log } from "../log";
import { CHANNELS } from "./registry";
import type { MessageChannel } from "./types";

export async function notifySeller(sellerId: string, text: string): Promise<void> {
  try {
    const links = await db.channelLink.findMany({ where: { sellerId, kind: "telegram" } });
    await Promise.all(
      links.map(async (link) => {
        const channel = CHANNELS[link.kind as MessageChannel];
        if (!channel?.configured()) return;
        await channel.send(link.address, text, { expectReply: false });
      }),
    );
  } catch (error) {
    log.warn("bidder notify failed", { sellerId, error: error instanceof Error ? error.message : String(error) });
  }
}
