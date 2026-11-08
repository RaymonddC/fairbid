// Server side of the message channels: linking a seller's chat, sending a question to
// it, and turning an inbound message into a reply through `addReply`, the same path as
// the in-app inbox. Everything here is optional: a failure is logged and never stops
// the in-app flow.

import { createHash, randomInt } from "node:crypto";
import { db } from "../db";
import { StepError, addReply, isUniqueViolation } from "../workflow";
import { CHANNELS } from "./registry";
import { telegramLink } from "./telegram";
import { parseLinkCommand, type InboundMessage, type MessageChannel } from "./types";
import { normalizeWhatsApp, parseAllowlist } from "./whatsapp";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
const CODE_TTL_MS = 15 * 60_000;

export const hashCode = (code: string) => createHash("sha256").update(code.toUpperCase()).digest("hex");

function newCode(): string {
  return Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

/** Channels the app can use right now, for the seller's page. */
export function availableChannels(): { kind: MessageChannel; label: string }[] {
  return Object.values(CHANNELS).filter((c) => c.configured()).map((c) => ({ kind: c.kind, label: c.label }));
}

export type LinkOffer = { code: string; url: string | null; expiresInMinutes: number };

/** A fresh one-time code for the signed-in seller. The previous code for that channel stops working. */
export async function createLinkCode(sellerId: string, kind: MessageChannel): Promise<LinkOffer> {
  const channel = CHANNELS[kind];
  if (!channel.configured()) throw new StepError(`${channel.label} is not switched on for this site.`);
  const code = newCode();
  await db.$transaction([
    db.channelLinkCode.deleteMany({ where: { sellerId, kind } }),
    db.channelLinkCode.create({ data: { codeHash: hashCode(code), sellerId, kind, expiresAt: new Date(Date.now() + CODE_TTL_MS) } }),
  ]);
  const number = normalizeWhatsApp(process.env.TWILIO_WHATSAPP_FROM ?? "");
  const url =
    kind === "telegram"
      ? telegramLink(code)
      : number
        ? `https://wa.me/${number.slice(1)}?text=${encodeURIComponent(`link ${code}`)}`
        : null;
  return { code, url, expiresInMinutes: CODE_TTL_MS / 60_000 };
}

export async function unlinkChannel(sellerId: string, kind: MessageChannel) {
  await db.channelLink.deleteMany({ where: { sellerId, kind } });
  await db.channelLinkCode.deleteMany({ where: { sellerId, kind } });
}

export async function linksOf(sellerId: string) {
  return db.channelLink.findMany({ where: { sellerId }, select: { kind: true, address: true } });
}

// ── Inbound ──────────────────────────────────────────────────────────────────

const HOW_TO_LINK = "This chat is not linked to a FairBid seller. Sign in to FairBid as a seller, open your dashboard, and press Link on this channel.";

/** Handles one inbound message and returns the text to answer with. Throws only for
 * failures worth a retry (the database); anything a person caused is answered in words. */
export async function handleInbound(msg: InboundMessage): Promise<string> {
  const code = parseLinkCommand(msg.text);
  if (code) return linkChat(msg, code);
  if (/^\s*\/start(@\w+)?\s*$/i.test(msg.text)) return HOW_TO_LINK;

  const link = await db.channelLink.findUnique({ where: { kind_address: { kind: msg.kind, address: msg.address } } });
  if (!link) return HOW_TO_LINK;

  // The seller used Reply on one of our messages, or has exactly one question waiting.
  let target: { clarificationId: string; bidId: string } | null = null;
  if (msg.replyToExternalId) {
    target = await db.channelMessage.findUnique({
      where: { linkId_externalId: { linkId: link.id, externalId: msg.replyToExternalId } },
      select: { clarificationId: true, bidId: true },
    });
    if (!target) return "I could not tell which question that answers. Reply to the question message itself.";
  } else {
    const recent = await db.channelMessage.findMany({ where: { linkId: link.id }, orderBy: { sentAt: "desc" }, take: 20 });
    const replies = recent.length
      ? await db.reply.findMany({ where: { bidId: { in: recent.map((m) => m.bidId) } }, select: { clarificationId: true, bidId: true } })
      : [];
    const open = recent.filter((m) => !replies.some((r) => r.clarificationId === m.clarificationId && r.bidId === m.bidId));
    if (open.length === 0) return "There is no question waiting for you. When a buyer asks one, it appears here.";
    if (open.length > 1) return `You have ${open.length} questions waiting. Reply to the message of the one you are answering, so the answer goes to the right buyer.`;
    target = open[0];
  }

  const account = await db.account.findFirst({ where: { sellerId: link.sellerId }, select: { id: true } });
  try {
    await addReply(target.clarificationId, target.bidId, msg.text, account?.id ?? `seller:${link.sellerId}`, msg.kind);
  } catch (error) {
    if (error instanceof StepError) return error.message;
    throw error;
  }
  return "Thank you. Your answer is recorded in FairBid.";
}

async function linkChat(msg: InboundMessage, code: string): Promise<string> {
  if (!msg.private) return "Open a private chat with me to link it. A group cannot be linked.";
  if (msg.kind === "whatsapp" && !parseAllowlist(process.env.CHANNEL_ALLOWLIST).has(msg.address)) {
    return "This number is not on the list of numbers that may link in this demo.";
  }
  const row = await db.channelLinkCode.findUnique({ where: { codeHash: hashCode(code) } });
  if (!row || row.kind !== msg.kind || row.expiresAt < new Date()) return "That code is not valid or has expired. Press Link again in FairBid for a new one.";
  await db.$transaction([
    // A chat belongs to one seller: whoever proves it last holds it.
    db.channelLink.deleteMany({ where: { kind: msg.kind, address: msg.address } }),
    db.channelLink.deleteMany({ where: { sellerId: row.sellerId, kind: msg.kind } }),
    db.channelLink.create({ data: { sellerId: row.sellerId, kind: msg.kind, address: msg.address } }),
    db.channelLinkCode.delete({ where: { codeHash: row.codeHash } }),
  ]);
  return "Linked. Questions from buyers will arrive here. Reply to a question to answer it; the in-app inbox keeps working too.";
}

/** Records that a delivery was handled. False when it was already handled before. */
export async function firstDelivery(id: string, eventType: string): Promise<boolean> {
  try {
    await db.webhookEvent.create({ data: { id, eventType } });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

export async function forgetDelivery(id: string) {
  await db.webhookEvent.delete({ where: { id } }).catch(() => undefined);
}
