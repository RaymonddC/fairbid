// Server side of the message channels: linking a seller's chat, sending a question to
// it, and turning an inbound message into a reply through `addReply`, the same path as
// the in-app inbox. Everything here is optional: a failure is logged and never stops
// the in-app flow.

import { createHash, randomInt } from "node:crypto";
import { db } from "../db";
import { StepError, addReply, isUniqueViolation } from "../workflow";
import { BUYER_HELP, pickLinkCode, routeInbound } from "./buyer";
import { answerQuestionFromChat } from "./buyer-notify";
import { answerPrompt, chatWithAgent, refreshCommands, runCommand, runTap, type BotReply, type ChatSides } from "./bot";
import { parseCommand } from "./bot-text";
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

// ── Buyers ───────────────────────────────────────────────────────────────────
// A buyer links a chat the same way, in tables of its own, so the seller path is unchanged.
// Telegram only.

/** A fresh one-time code for the signed-in buyer. The previous code stops working. */
export async function createBuyerLinkCode(accountId: string, kind: MessageChannel): Promise<LinkOffer> {
  const channel = CHANNELS[kind];
  if (kind !== "telegram") throw new StepError("Tender owners can link Telegram only.");
  if (!channel.configured()) throw new StepError(`${channel.label} is not switched on for this site.`);
  const code = newCode();
  await db.$transaction([
    db.buyerLinkCode.deleteMany({ where: { accountId, kind } }),
    db.buyerLinkCode.create({ data: { codeHash: hashCode(code), accountId, kind, expiresAt: new Date(Date.now() + CODE_TTL_MS) } }),
  ]);
  return { code, url: telegramLink(code), expiresInMinutes: CODE_TTL_MS / 60_000 };
}

export async function unlinkBuyerChannel(accountId: string, kind: MessageChannel) {
  await db.buyerChannelLink.deleteMany({ where: { accountId, kind } });
  await db.buyerLinkCode.deleteMany({ where: { accountId, kind } });
}

export async function buyerLinksOf(accountId: string) {
  return db.buyerChannelLink.findMany({ where: { accountId }, select: { kind: true, address: true } });
}

/** Channels a buyer can link: Telegram, when it is switched on. */
export function buyerChannels() {
  return availableChannels().filter((c) => c.kind === "telegram");
}

// ── Inbound ──────────────────────────────────────────────────────────────────

const FOLLOW_UP_MS = 10 * 60_000;
const MAX_ANSWER = 1000; // the limit addReply keeps

const HOW_TO_LINK = "This chat is not linked to FairBid. Sign in to FairBid as a bidder or a tender owner, open your dashboard, and press Link on this channel.";

const say = (text: string): BotReply => ({ text });

/** Handles one inbound message, or a tap on one of our buttons, and returns what to answer
 * with (null when the answer was already sent). Throws only for failures worth a retry (the
 * database); anything a person caused is answered in words. */
export async function handleInbound(msg: InboundMessage): Promise<BotReply> {
  const code = msg.tap ? null : parseLinkCommand(msg.text);
  const [link, buyerLink] = code
    ? [null, null]
    : await Promise.all([
        db.channelLink.findUnique({ where: { kind_address: { kind: msg.kind, address: msg.address } } }),
        db.buyerChannelLink.findUnique({ where: { kind_address: { kind: msg.kind, address: msg.address } } }),
      ]);
  // Who is acting comes from the chat's links, never from what the message says.
  const sides: ChatSides = { address: msg.address, ownerAccountId: buyerLink?.accountId ?? null, sellerId: link?.sellerId ?? null };
  const telegram = msg.kind === "telegram";
  if (msg.tap) return link || buyerLink ? (telegram ? runTap(msg, sides) : null) : say(HOW_TO_LINK);

  // A reply to a message sent to the buyer side of this chat belongs to the buyer, even when
  // the same chat is also a seller's.
  const buyerMessage =
    buyerLink && msg.replyToExternalId
      ? await db.buyerChannelMessage.findUnique({
          where: { linkId_externalId: { linkId: buyerLink.id, externalId: msg.replyToExternalId } },
          select: { tenderQuestionId: true },
        })
      : null;
  const route = routeInbound({
    linkCode: Boolean(code),
    bareStart: /^\s*\/start(@\w+)?\s*$/i.test(msg.text),
    sellerLinked: Boolean(link),
    buyerLinked: Boolean(buyerLink),
    repliesToBuyer: buyerMessage,
  });
  if (route === "link") return say(await linkChat(msg, code!));
  if (!link && !buyerLink) return say(HOW_TO_LINK);
  if (route === "buyer-answer") return say(await answerQuestionFromChat(buyerLink!.accountId, buyerMessage!.tenderQuestionId!, msg.text));

  if (telegram) {
    // A reply to one of the bot's "type your question" messages.
    if (link && msg.replyToExternalId) {
      const prompt = await db.chatPrompt.findUnique({
        where: { kind_address_externalId: { kind: msg.kind, address: msg.address, externalId: msg.replyToExternalId } },
        select: { action: true, tenderId: true },
      });
      if (prompt) return answerPrompt(prompt, msg.text, link.sellerId);
    }
    const command = parseCommand(msg.text);
    if (command) return runCommand(command, sides);
  }
  if (route === "buyer-help" || route === "how-to-link") return telegram ? chatWithAgent(msg.text, sides) : say(BUYER_HELP);
  if (!link) return say(HOW_TO_LINK);

  // The seller used Reply on one of our messages. On WhatsApp, which has no reliable Reply,
  // a message may also answer the one question waiting; on Telegram anything else is a
  // message to their agent.
  let target: { clarificationId: string; bidId: string } | null = null;
  if (msg.replyToExternalId) {
    target = await db.channelMessage.findUnique({
      where: { linkId_externalId: { linkId: link.id, externalId: msg.replyToExternalId } },
      select: { clarificationId: true, bidId: true },
    });
    if (!target) return telegram ? chatWithAgent(msg.text, sides) : say("I could not tell which question that answers. Reply to the question message itself.");
  } else if (telegram) {
    return chatWithAgent(msg.text, sides);
  } else {
    const recent = await db.channelMessage.findMany({ where: { linkId: link.id }, orderBy: { sentAt: "desc" }, take: 20 });
    const replies = recent.length
      ? await db.reply.findMany({ where: { bidId: { in: recent.map((m) => m.bidId) } }, select: { clarificationId: true, bidId: true, receivedAt: true } })
      : [];
    const replyOf = (m: { clarificationId: string; bidId: string }) => replies.find((r) => r.clarificationId === m.clarificationId && r.bidId === m.bidId);
    const open = recent.filter((m) => !replyOf(m));
    if (open.length > 1) return say(`You have ${open.length} questions waiting. Reply to the message of the one you are answering, so the answer goes to the right tender owner.`);
    // A second message right after an answer continues it, as people write in bursts.
    const justAnswered = recent.find((m) => {
      const r = replyOf(m);
      return r && Date.now() - r.receivedAt.getTime() < FOLLOW_UP_MS;
    });
    target = open[0] ?? justAnswered ?? null;
    if (!target) return say("There is no question waiting for you. When a tender owner asks one, it appears here.");
  }

  const account = await db.account.findFirst({ where: { sellerId: link.sellerId }, select: { id: true } });
  // One answer per question: a further message adds to it instead of replacing it, so the
  // seller can answer in several bubbles.
  const previous = await db.reply.findUnique({
    where: { clarificationId_bidId: { clarificationId: target.clarificationId, bidId: target.bidId } },
    select: { body: true },
  });
  const body = previous ? `${previous.body}\n\n${msg.text.trim()}` : msg.text;
  if (body.trim().length > MAX_ANSWER) return say(`That would make the answer longer than ${MAX_ANSWER} characters. Shorten it, or finish in FairBid.`);
  try {
    await addReply(target.clarificationId, target.bidId, body, account?.id ?? `seller:${link.sellerId}`, msg.kind);
  } catch (error) {
    if (error instanceof StepError) return say(error.message);
    throw error;
  }
  return say("Thank you. Your answer is recorded in FairBid.");
}

async function linkChat(msg: InboundMessage, code: string): Promise<string> {
  if (!msg.private) return "Open a private chat with me to link it. A group cannot be linked.";
  if (msg.kind === "whatsapp" && !parseAllowlist(process.env.CHANNEL_ALLOWLIST).has(msg.address)) {
    return "This number is not on the list of numbers that may link in this demo.";
  }
  const [row, buyerRow] = await Promise.all([
    db.channelLinkCode.findUnique({ where: { codeHash: hashCode(code) } }),
    db.buyerLinkCode.findUnique({ where: { codeHash: hashCode(code) } }),
  ]);
  const side = pickLinkCode(row, buyerRow, msg.kind);
  if (!side) return "That code is not valid or has expired. Press Link again in FairBid for a new one.";
  if (side === "buyer") return linkBuyerChat(msg, buyerRow!);
  if (!row) return "That code is not valid or has expired. Press Link again in FairBid for a new one.";
  await db.$transaction([
    // A chat belongs to one seller: whoever proves it last holds it.
    db.channelLink.deleteMany({ where: { kind: msg.kind, address: msg.address } }),
    db.channelLink.deleteMany({ where: { sellerId: row.sellerId, kind: msg.kind } }),
    db.channelLink.create({ data: { sellerId: row.sellerId, kind: msg.kind, address: msg.address } }),
    db.channelLinkCode.delete({ where: { codeHash: row.codeHash } }),
  ]);
  if (msg.kind === "telegram") await refreshCommands(await sidesOfChat(msg));
  return msg.kind === "telegram"
    ? "Linked as a bidder. /open shows open tenders, where your agent can bid or you can ask the tender owner. /bids shows your bids, /agent switches your agent on or off. Or just write to your agent here."
    : "Linked. Questions from tender owners will arrive here. Reply to a question to answer it; the in-app inbox keeps working too.";
}

async function linkBuyerChat(msg: InboundMessage, row: { codeHash: string; accountId: string }): Promise<string> {
  await db.$transaction([
    // A chat belongs to one buyer: whoever proves it last holds it. A seller link to the same chat is untouched.
    db.buyerChannelLink.deleteMany({ where: { kind: msg.kind, address: msg.address } }),
    db.buyerChannelLink.deleteMany({ where: { accountId: row.accountId, kind: msg.kind } }),
    db.buyerChannelLink.create({ data: { accountId: row.accountId, kind: msg.kind, address: msg.address } }),
    db.buyerLinkCode.delete({ where: { codeHash: row.codeHash } }),
  ]);
  await refreshCommands(await sidesOfChat(msg));
  return "Linked as a tender owner. New sealed bids (the count only), bidders' questions and your agent's answers arrive here. /tenders shows your tenders with buttons to answer, sum up or close bidding. Or just write to your agent here.";
}

async function sidesOfChat(msg: InboundMessage): Promise<ChatSides> {
  const [link, buyerLink] = await Promise.all([
    db.channelLink.findUnique({ where: { kind_address: { kind: msg.kind, address: msg.address } }, select: { sellerId: true } }),
    db.buyerChannelLink.findUnique({ where: { kind_address: { kind: msg.kind, address: msg.address } }, select: { accountId: true } }),
  ]);
  return { address: msg.address, sellerId: link?.sellerId ?? null, ownerAccountId: buyerLink?.accountId ?? null };
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
