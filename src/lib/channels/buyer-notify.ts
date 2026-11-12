// Updates to a buyer's linked chat (Telegram), and the tender owner's answer to a seller's
// question when it comes back as a reply. Optional like every channel: nothing here throws
// into the action that caused it, and a chat that is down never blocks anything. Before
// close a buyer learns only the count of bids, never a price, a seller or a letter.
// Imports no workflow code, because the workflow calls this file.

import { after } from "next/server";
import { db } from "../db";
import { log } from "../log";
import { bidLetter } from "../scoring";
import { CHANNELS } from "./registry";
import { deliverToBuyer, newBidText, replyText, sellerQuestionText } from "./buyer";
import { tapData } from "./bot-text";
import { siteUrl } from "./site-url";
import type { Button, MessageChannel } from "./types";

const openButton = (tenderId: string, text = "Open in FairBid", path = ""): Button[] => {
  const url = siteUrl(`/tender/${tenderId}${path}`);
  return url ? [{ text, url }] : [];
};

/** Runs a notification after the response when there is a request, or in the background
 * otherwise (scripts, tests). The caller never waits for a chat. */
export function inBackground(fn: () => Promise<unknown>) {
  const run = () =>
    fn().catch((error) => log.warn("tender owner notification failed", { error: error instanceof Error ? error.message : String(error) }));
  try {
    after(run);
  } catch {
    void run();
  }
}

/** Sends text to the buyer's linked chats and records each message, so a reply finds it.
 * Never throws. */
export async function notifyBuyer(accountId: string, text: string, opts: { tenderQuestionId?: string; buttons?: Button[][] } = {}): Promise<void> {
  try {
    const links = await db.buyerChannelLink.findMany({ where: { accountId, kind: "telegram" } });
    await Promise.all(
      links.map((link) => {
        const channel = CHANNELS[link.kind as MessageChannel];
        if (!channel?.configured()) return false;
        return deliverToBuyer(link.address, text, Boolean(opts.tenderQuestionId), {
          send: (address, body, o) => channel.send(address, body, o),
          record: async (externalId) => {
            await db.buyerChannelMessage.create({ data: { linkId: link.id, externalId, tenderQuestionId: opts.tenderQuestionId ?? null } });
          },
          warn: (message, fields) => log.warn(message, { ...fields, kind: link.kind, accountId }),
        }, opts.tenderQuestionId ? undefined : opts.buttons);
      }),
    );
  } catch (error) {
    log.warn("tender owner notify failed", { accountId, error: error instanceof Error ? error.message : String(error) });
  }
}

/** The owner's agent answered a bidder's question from the tender: the owner sees the exchange in their chat. No bidder is named. */
export async function notifyBuyerOfAiAnswer(tenderId: string, question: string, answer: string, byAgent: boolean): Promise<void> {
  try {
    const t = await db.tender.findUnique({ where: { id: tenderId }, select: { title: true, buyerId: true } });
    if (!t?.buyerId) return;
    await notifyBuyer(
      t.buyerId,
      `FairBid: ${byAgent ? "a bidder's agent" : "a bidder"} asked about "${t.title}":

${question}

Your agent answered from the tender, for every bidder:

${answer}`,
      { buttons: [openButton(tenderId)] },
    );
  } catch (error) {
    log.warn("tender owner AI answer notify failed", { tenderId, error: error instanceof Error ? error.message : String(error) });
  }
}

/** A new sealed bid arrived while bidding is open: the count, nothing else. */
export async function notifyBuyerOfNewBid(tenderId: string): Promise<void> {
  const t = await db.tender.findUnique({ where: { id: tenderId }, select: { title: true, buyerId: true, status: true, _count: { select: { bids: true } } } });
  if (!t?.buyerId || t.status !== "OPEN") return;
  await notifyBuyer(t.buyerId, newBidText(t.title, t._count.bids), {
    buttons: [[{ text: "Close bidding now", data: tapData.owner("c", tenderId) }, ...openButton(tenderId)]],
  });
}

/** A seller answered the buyer's clarification. Named by bid letter, as the buyer scores blind. */
export async function notifyBuyerOfReply(clarificationId: string, bidId: string, answer: string): Promise<void> {
  const c = await db.clarification.findUnique({ where: { id: clarificationId }, select: { tender: { select: { id: true, title: true, buyerId: true } } } });
  if (!c?.tender.buyerId) return;
  // The same order as the buyer's tender page, so the letter matches what they see.
  const bids = await db.bid.findMany({ where: { tenderId: c.tender.id }, orderBy: [{ submittedAt: "asc" }, { sellerId: "asc" }], select: { id: true } });
  const index = bids.findIndex((b) => b.id === bidId);
  if (index < 0) return;
  await notifyBuyer(c.tender.buyerId, replyText(c.tender.title, bidLetter(index), answer), { buttons: [openButton(c.tender.id, "Compare bids", "/compare")] });
}

/** A seller asked about an open tender. The buyer can answer by replying in the chat. */
export async function notifyBuyerOfSellerQuestion(tenderId: string, questionId: string, questionText: string): Promise<void> {
  try {
    const t = await db.tender.findUnique({ where: { id: tenderId }, select: { title: true, buyerId: true } });
    if (!t?.buyerId) return;
    await notifyBuyer(t.buyerId, sellerQuestionText(t.title, questionText), { tenderQuestionId: questionId });
  } catch (error) {
    log.warn("bidder question notify failed", { tenderId, questionId, error: error instanceof Error ? error.message : String(error) });
  }
}

const MAX_ANSWER = 1000;

/** The buyer's answer to a bidder's question, sent as a reply in the chat. Written only when
 * this buyer owns the tender and nobody answered it yet. Returns the words to reply with. */
export async function answerQuestionFromChat(accountId: string, tenderQuestionId: string, text: string): Promise<string> {
  const answer = text.trim();
  if (!answer) return "Write the answer as a reply to the question.";
  if (answer.length > MAX_ANSWER) return `Keep the answer under ${MAX_ANSWER} characters, or answer in FairBid.`;
  // The same answer path as the website: owner check, still open, first answer wins, logged.
  // Loaded here, not at the top, because tender-questions imports this file.
  const { answerTenderQuestion } = await import("../tender-questions");
  try {
    await answerTenderQuestion({ questionId: tenderQuestionId, buyerAccountId: accountId, answer });
    return "Thank you. Your answer is published to every bidder on this tender.";
  } catch (error) {
    return error instanceof Error ? error.message : "That answer could not be saved. Answer in FairBid instead.";
  }
}
