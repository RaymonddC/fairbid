// The Telegram bot as a small FairBid of its own: commands, buttons under each tender, and
// the person's own agent to talk to. Server only.
//
// Who is acting always comes from the chat's link (a one-time code proved it), never from a
// button's data or a message: a button names only a tender, and every action checks that
// tender against the linked account, as the website's actions check the session. Nothing
// here moves money or awards: those stay in the website. Sealed bids stay sealed: a tender
// owner sees only the count of bids before close, as everywhere else.

import { chatAsAgent } from "../ai/roles";
import { agentActivity, answerAgentQuestions, runOwnAgent } from "../agents/own-agent";
import { demoAgentDeps } from "../agents/demo-deps";
import { scheduleDemoAnswers } from "../agents/demo-schedule";
import { db } from "../db";
import { countryName, dayTime, money } from "../format";
import { log } from "../log";
import { createLimiter } from "../rate-limit";
import { askTenderQuestion, latestOwnerSummary, refreshOwnerSummary } from "../tender-questions";
import { StepError, assertOwner, closeBidding } from "../workflow";
import { sellerQuestionText } from "./buyer";
import { inBackground, notifyBuyer } from "./buyer-notify";
import {
  askPrompt,
  bidStatus,
  commandsFor,
  helpText,
  openTenderCard,
  ownerStatus,
  ownerTenderCard,
  parseTap,
  tapData,
  type Command,
  type Sides,
} from "./bot-text";
import { CHANNELS } from "./registry";
import { notifySeller } from "./seller-notify";
import { siteUrl } from "./site-url";
import { setChatCommands } from "./telegram";
import type { Button, InboundMessage } from "./types";

export type BotReply = { text: string; buttons?: Button[][] } | null;

/** Who this chat is, from its links. Either side may be missing; both may be the same chat. */
export interface ChatSides {
  address: string;
  ownerAccountId: string | null;
  sellerId: string | null;
}

const sidesOf = (c: ChatSides): Sides => ({ owner: Boolean(c.ownerAccountId), bidder: Boolean(c.sellerId) });


async function say(address: string, text: string, buttons?: Button[][]) {
  await CHANNELS.telegram.send(address, text, { expectReply: false, buttons });
}

const LIST_MAX = 6;
const chatsPerHour = createLimiter(30, 60 * 60_000);
const runsPerHour = createLimiter(10, 60 * 60_000);

/** Lists the commands under "/" for the sides this chat is linked to. Never throws. */
export async function refreshCommands(c: ChatSides) {
  await setChatCommands(c.address, commandsFor(sidesOf(c)));
}

// ── Commands ────────────────────────────────────────────────────────────────

export async function runCommand(cmd: Command, c: ChatSides): Promise<BotReply> {
  const sides = sidesOf(c);
  if (cmd === "start" || cmd === "help") {
    await refreshCommands(c);
    return { text: helpText(sides) };
  }
  if (cmd === "tenders" || cmd === "waiting") {
    if (!c.ownerAccountId) return { text: "This chat is linked as a bidder. Link it on the tender owner's Your agent page to see tenders you posted." };
    return cmd === "tenders" ? ownerTenders(c.address, c.ownerAccountId) : ownerWaiting(c.address, c.ownerAccountId);
  }
  if (!c.sellerId) return { text: "This chat is linked as a tender owner. Link it on a bidder's Your agent page to bid from here." };
  if (cmd === "open") return openTenders(c.address, c.sellerId);
  if (cmd === "bids") return myBids(c.sellerId);
  return agentCard(c.sellerId);
}

async function ownerTenders(address: string, accountId: string): Promise<BotReply> {
  const tenders = await db.tender.findMany({
    where: { buyerId: accountId, status: { notIn: ["DRAFT"] } },
    orderBy: { createdAt: "desc" },
    take: LIST_MAX,
    select: { id: true, title: true, status: true, closesAt: true, _count: { select: { bids: true } }, questions: { select: { answer: true } } },
  });
  if (tenders.length === 0) return { text: "You have no tenders yet. Post one in FairBid and it shows here.", buttons: link("Post a tender", "/post") };
  await say(address, `Your ${tenders.length === LIST_MAX ? `${LIST_MAX} latest tenders` : `tender${tenders.length === 1 ? "" : "s"}`}:`);
  for (const t of tenders) {
    const card = ownerTenderCard(
      {
        id: t.id,
        title: t.title,
        status: t.status,
        bids: t._count.bids,
        closes: dayTime(t.closesAt.toISOString()),
        waiting: t.status === "OPEN" ? t.questions.filter((q) => !q.answer).length : 0,
        answered: t.questions.filter((q) => q.answer).length,
      },
      siteUrl(`/tender/${t.id}`),
    );
    await say(address, card.text, card.buttons);
  }
  return null;
}

/** Sends each waiting question as its own message, so a reply to it answers that one. */
async function sendWaiting(accountId: string, tenderIds: string[]): Promise<number> {
  const waiting = await db.tenderQuestion.findMany({
    where: { tenderId: { in: tenderIds }, answer: null, tender: { status: "OPEN", closesAt: { gt: new Date() } } },
    orderBy: { askedAt: "asc" },
    take: 10,
    select: { id: true, question: true, tender: { select: { title: true } } },
  });
  for (const q of waiting) await notifyBuyer(accountId, sellerQuestionText(q.tender.title, q.question), { tenderQuestionId: q.id });
  return waiting.length;
}

async function ownerWaiting(address: string, accountId: string): Promise<BotReply> {
  const tenders = await db.tender.findMany({ where: { buyerId: accountId, status: "OPEN" }, select: { id: true } });
  const count = await db.tenderQuestion.count({ where: { tenderId: { in: tenders.map((t) => t.id) }, answer: null } });
  if (count === 0) return { text: "No question waits for you. Your agent answers what the tender already settles; the rest comes here." };
  await say(address, `${count} question${count === 1 ? "" : "s"} wait${count === 1 ? "s" : ""} for you. Reply to each to answer every bidder; nobody is told who asked.`);
  await sendWaiting(accountId, tenders.map((t) => t.id));
  return null;
}

async function openTenders(address: string, sellerId: string): Promise<BotReply> {
  const tenders = await db.tender.findMany({
    where: { status: "OPEN", closesAt: { gt: new Date() } },
    orderBy: { closesAt: "asc" },
    take: LIST_MAX,
    select: {
      id: true,
      title: true,
      spec: true,
      budgetCents: true,
      currency: true,
      destinationCountry: true,
      closesAt: true,
      bids: { where: { sellerId }, select: { id: true } },
      questions: { where: { answer: { not: null } }, select: { id: true } },
    },
  });
  if (tenders.length === 0) return { text: "No tender is open right now. A new one shows here when it opens." };
  await say(address, `${tenders.length} open tender${tenders.length === 1 ? "" : "s"}, closing soonest first:`);
  for (const t of tenders) {
    const spec = (t.spec ?? {}) as { item?: string; quantity?: number };
    const card = openTenderCard(
      {
        id: t.id,
        title: t.title,
        quantity: Number(spec.quantity ?? 1),
        item: spec.item ?? t.title,
        destination: countryName(t.destinationCountry),
        budget: money(t.budgetCents, t.currency),
        closes: dayTime(t.closesAt.toISOString()),
        youBid: t.bids.length > 0,
        answers: t.questions.length,
      },
      siteUrl(`/tender/${t.id}`),
    );
    await say(address, card.text, card.buttons);
  }
  return null;
}

async function myBids(sellerId: string): Promise<BotReply> {
  const bids = await db.bid.findMany({
    where: { sellerId },
    orderBy: { submittedAt: "desc" },
    take: 8,
    select: { id: true, tenderId: true, lines: { select: { amountCents: true } }, tender: { select: { title: true, status: true, currency: true, award: { select: { bidId: true } } } } },
  });
  if (bids.length === 0) return { text: "You have no bids yet. /open shows the open tenders, and your agent can bid on one for you." };
  const asked = await waitingClarifications(sellerId);
  const lines = bids.map((b) => {
    const total = b.lines.reduce((s, l) => s + l.amountCents, 0);
    const won = b.tender.award ? b.tender.award.bidId === b.id : null;
    return `${b.tender.title}\n${bidStatus(b.tender.status, won)}. Your bid: ${money(total, b.tender.currency)}, before duty and VAT.`;
  });
  if (asked) lines.push(`${asked} question${asked === 1 ? "" : "s"} from a tender owner wait${asked === 1 ? "s" : ""} for you: reply to the question message to answer.`);
  return { text: `Your bids:\n\n${lines.join("\n\n")}`, buttons: link("Open FairBid", "/") };
}

/** Questions a tender owner asked this seller after close that have no answer yet. */
async function waitingClarifications(sellerId: string): Promise<number> {
  const bids = await db.bid.findMany({ where: { sellerId }, select: { id: true, tenderId: true } });
  if (bids.length === 0) return 0;
  const cs = await db.clarification.findMany({
    where: { tenderId: { in: bids.map((b) => b.tenderId) } },
    select: { sentTo: true, tenderId: true, replies: { select: { bidId: true } } },
  });
  return cs.filter((c) => {
    const bid = bids.find((b) => b.tenderId === c.tenderId);
    return Array.isArray(c.sentTo) && (c.sentTo as string[]).includes(sellerId) && bid && !c.replies.some((r) => r.bidId === bid.id);
  }).length;
}

async function agentCard(sellerId: string): Promise<BotReply> {
  const s = await db.seller.findUnique({ where: { id: sellerId }, select: { agentOn: true, agentBrief: true } });
  const brief = s?.agentBrief?.trim() ?? "";
  if (!brief) {
    return { text: "Your agent has nothing to go on yet. Tell it what you make and what it costs on the Your agent page, then switch it on here.", buttons: link("Your agent", "/agent") };
  }
  const recent = await agentActivity(sellerId, 3);
  const lines = [
    `Your agent is ${s?.agentOn ? "on: it bids on tenders that fit what you make" : "off"}.`,
    "",
    `What it knows: ${brief.length > 300 ? `${brief.slice(0, 297)}...` : brief}`,
    ...(recent.length ? ["", "Lately:", ...recent.map((a) => `- ${a.text.length > 220 ? `${a.text.slice(0, 217)}...` : a.text}`)] : []),
  ];
  return {
    text: lines.join("\n"),
    buttons: [
      s?.agentOn
        ? [
            { text: "Run it now", data: tapData.agent("run") },
            { text: "Switch off", data: tapData.agent("off") },
          ]
        : [{ text: "Switch on", data: tapData.agent("on") }],
      ...link("Change what it knows", "/agent"),
    ],
  };
}

const link = (text: string, path: string): Button[][] => {
  const url = siteUrl(path);
  return url ? [[{ text, url }]] : [];
};

// ── Buttons ─────────────────────────────────────────────────────────────────

export async function runTap(msg: InboundMessage, c: ChatSides): Promise<BotReply> {
  const tap = parseTap(msg.tap?.data ?? "");
  if (!tap) return null;
  if (tap.verb === "dismiss") return { text: "Fine, nothing changed." };
  if (tap.side === "owner") {
    if (!c.ownerAccountId) return { text: "This chat is not linked as a tender owner." };
    try {
      await assertOwner(tap.tenderId, c.ownerAccountId);
    } catch {
      return { text: "That tender belongs to another tender owner." };
    }
    return ownerTap(tap.verb, tap.tenderId, c.ownerAccountId, c.address);
  }
  if (!c.sellerId) return { text: "This chat is not linked as a bidder." };
  if (tap.verb === "bids") return myBids(c.sellerId);
  if (tap.verb === "ask") return askFor(tap.tenderId, c);
  if (tap.verb === "agent-bid") return agentBid(tap.tenderId, c.sellerId);
  if (tap.verb === "agent-run") return agentRun(c.sellerId);
  return agentSwitch(c.sellerId, tap.verb === "agent-on");
}

async function ownerTap(verb: "questions" | "summary" | "close" | "confirm-close", tenderId: string, accountId: string, address: string): Promise<BotReply> {
  const t = await db.tender.findUniqueOrThrow({ where: { id: tenderId }, select: { title: true, status: true, _count: { select: { bids: true } } } });
  if (verb === "questions") {
    const qs = await db.tenderQuestion.findMany({ where: { tenderId }, orderBy: { askedAt: "asc" }, select: { question: true, answer: true, answeredBy: true } });
    const answered = qs.filter((q) => q.answer);
    if (qs.length === 0) return { text: `No bidder has asked about "${t.title}" yet.` };
    if (answered.length) {
      const list = answered
        .slice(-5)
        .map((q) => `Q: ${q.question}\nA (${q.answeredBy === "buyer" ? "you" : "your agent"}): ${q.answer}`)
        .join("\n\n");
      await say(address, `Answered on "${t.title}", for every bidder:\n\n${list}`);
    }
    const sent = await sendWaiting(accountId, [tenderId]);
    if (!sent) return { text: answered.length === qs.length ? "Nothing waits for you on this tender." : "Bidding has closed, so the questions left can no longer be answered." };
    return null;
  }
  if (verb === "summary") {
    const latest = await latestOwnerSummary(tenderId);
    const summary = latest?.summary ?? (await refreshOwnerSummary(tenderId));
    return { text: summary ? `Your agent on "${t.title}":\n\n${summary}` : `Nothing to sum up on "${t.title}" yet.` };
  }
  if (t.status !== "OPEN") return { text: `Bidding on "${t.title}" is already closed.`, buttons: link("Compare bids", `/tender/${tenderId}/compare`) };
  if (verb === "close") {
    const n = t._count.bids;
    return {
      text: `Close bidding on "${t.title}" now? ${n === 0 ? "No bid has arrived, so the tender would end with nobody to award." : `The ${n} sealed bid${n === 1 ? "" : "s"} open to you, and your agent writes its questions for bidders. No bid can be added after.`}`,
      buttons: [
        [
          { text: "Yes, close bidding", data: tapData.owner("C", tenderId) },
          { text: "Not yet", data: tapData.dismiss },
        ],
      ],
    };
  }
  try {
    await closeBidding(tenderId, accountId);
  } catch (error) {
    if (error instanceof StepError) return { text: error.message };
    throw error;
  }
  // The same follow-ups as closing in the website.
  inBackground(() => answerAgentQuestions(tenderId));
  inBackground(() => scheduleDemoAnswers(tenderId, demoAgentDeps(tenderId, accountId)));
  const n = t._count.bids;
  if (n === 0) return { text: `Bidding on "${t.title}" closed with no bids, so the tender has ended. Nobody was charged.` };
  return {
    text: `Bidding on "${t.title}" is closed. ${n} bid${n === 1 ? " is" : "s are"} open to you now, compared at delivered cost. Your agent asks bidders what their bids leave out, and their answers arrive here. Score and award in FairBid.`,
    buttons: link("Compare bids", `/tender/${tenderId}/compare`),
  };
}

async function askFor(tenderId: string, c: ChatSides): Promise<BotReply> {
  const t = await db.tender.findUnique({ where: { id: tenderId }, select: { title: true, status: true, closesAt: true } });
  if (!t || t.status !== "OPEN" || t.closesAt <= new Date()) return { text: "Questions close when bidding closes." };
  const { externalId } = await CHANNELS.telegram.send(c.address, askPrompt(t.title));
  await db.chatPrompt.create({ data: { kind: "telegram", address: c.address, externalId, action: "ask", tenderId } });
  return null;
}

/** A bidder's reply to one of our "type your question" prompts. */
export async function answerPrompt(prompt: { action: string; tenderId: string }, text: string, sellerId: string): Promise<BotReply> {
  if (prompt.action !== "ask") return null;
  try {
    const q = await askTenderQuestion({ tenderId: prompt.tenderId, sellerId, question: text, via: "seller" });
    if (q.answer) return { text: `The tender owner's AI answered from the tender, for every bidder:\n\n${q.answer}` };
    return { text: "Sent. The tender doesn't settle it, so it waits for the tender owner. Their answer comes to this chat." };
  } catch (error) {
    if (error instanceof StepError) return { text: error.message };
    throw error;
  }
}

async function agentBid(tenderId: string, sellerId: string): Promise<BotReply> {
  const s = await db.seller.findUnique({ where: { id: sellerId }, select: { agentOn: true, agentBrief: true } });
  if (!s?.agentBrief?.trim()) return { text: "Tell your agent what you make and what it costs first.", buttons: link("Your agent", "/agent") };
  if (!s.agentOn) return { text: "Your agent is off. Switch it on, then tap Let my agent bid again.", buttons: [[{ text: "Switch on", data: tapData.agent("on") }]] };
  const [t, bid] = await Promise.all([
    db.tender.findUnique({ where: { id: tenderId }, select: { title: true, status: true, closesAt: true } }),
    db.bid.findUnique({ where: { tenderId_sellerId: { tenderId, sellerId } }, select: { id: true } }),
  ]);
  if (!t || t.status !== "OPEN" || t.closesAt <= new Date()) return { text: "Bidding on that tender has closed." };
  if (bid) return { text: `You already have a sealed bid on "${t.title}".`, buttons: [[{ text: "Your bids", data: tapData.agent("bids") }]] };
  if (!runsPerHour.hit(sellerId)) return { text: "Your agent has run often this hour. Wait a few minutes." };
  inBackground(async () => {
    const steps = await runOwnAgent(sellerId, { tenderIds: [tenderId] });
    // A bid sends its own summary here; anything else is told in a line.
    if (steps.some((x) => x.kind === "agent.summary")) return;
    const step = steps.find((x) => x.kind === "agent.bid" || x.kind === "agent.skipped");
    const last = step
      ? null
      : await db.event.findFirst({ where: { tenderId, actor: `agent:${sellerId}`, kind: "agent.skipped" }, orderBy: { seq: "desc" }, select: { payload: true } });
    const reason = (last?.payload as { reason?: string } | undefined)?.reason;
    const text = step ? step.detail : reason ? `It already looked and skipped it: ${reason}` : "It could not bid on it this time. Look at the tender in FairBid.";
    await notifySeller(sellerId, `FairBid: your agent on "${t.title}":\n\n${text}`);
  });
  return { text: `Your agent is reading "${t.title}" now. It asks the tender owner what it needs, seals a bid from your prices if the tender fits, and sends you its summary here.` };
}

async function agentRun(sellerId: string): Promise<BotReply> {
  const s = await db.seller.findUnique({ where: { id: sellerId }, select: { agentOn: true, agentBrief: true } });
  if (!s?.agentOn || !s.agentBrief) return { text: "Your agent is off.", buttons: [[{ text: "Switch on", data: tapData.agent("on") }]] };
  if (!runsPerHour.hit(sellerId)) return { text: "Your agent has run often this hour. Wait a few minutes." };
  inBackground(async () => {
    const steps = await runOwnAgent(sellerId);
    if (steps.some((x) => x.kind === "agent.summary")) return;
    const bids = steps.filter((x) => x.kind === "agent.bid").length;
    const skipped = steps.filter((x) => x.kind === "agent.skipped").length;
    await notifySeller(
      sellerId,
      bids || skipped
        ? `FairBid: your agent looked at ${bids + skipped} open tender${bids + skipped === 1 ? "" : "s"}: bid on ${bids}, skipped ${skipped}.`
        : "FairBid: your agent found nothing new to bid on. It has looked at every open tender since you last changed what it knows.",
    );
  });
  return { text: "Your agent is looking at the open tenders now. What it does comes here." };
}

async function agentSwitch(sellerId: string, on: boolean): Promise<BotReply> {
  const s = await db.seller.findUnique({ where: { id: sellerId }, select: { agentBrief: true } });
  if (on && (s?.agentBrief?.trim().length ?? 0) < 20) return { text: "Tell your agent what you make and what it costs first.", buttons: link("Your agent", "/agent") };
  await db.seller.update({ where: { id: sellerId }, data: { agentOn: on } });
  // Switched on, it looks at every open tender, as when it is switched on in the website.
  if (on) inBackground(() => runOwnAgent(sellerId));
  return on
    ? { text: "Your agent is on. It looks at the open tenders now and bids where they fit what you make.", buttons: [[{ text: "Switch off", data: tapData.agent("off") }]] }
    : { text: "Your agent is off. Your sealed bids stay as they are.", buttons: [[{ text: "Switch on", data: tapData.agent("on") }]] };
}

// ── Talking to your agent ───────────────────────────────────────────────────

/** A message that is not a command or a reply: the person's own agent answers it, from what they may see. */
export async function chatWithAgent(text: string, c: ChatSides): Promise<BotReply> {
  if (!chatsPerHour.hit(c.address)) return { text: "That's a lot of messages this hour. Try again in a few minutes, or use /help." };
  const sides = sidesOf(c);
  try {
    const [owner, bidder] = await Promise.all([c.ownerAccountId ? ownerSnapshot(c.ownerAccountId) : null, c.sellerId ? bidderSnapshot(c.sellerId) : null]);
    const snapshot = { ...(owner ? { asTenderOwner: owner } : {}), ...(bidder ? { asBidder: bidder } : {}) };
    const fixture = () => {
      const parts = [
        ...(owner ? [`You have ${owner.tenders.length} tender${owner.tenders.length === 1 ? "" : "s"}${owner.tenders.length ? `: ${owner.tenders.map((t) => `${t.title} (${t.status})`).join("; ")}` : ""}.`] : []),
        ...(bidder ? [`You have ${bidder.myBids.length} bid${bidder.myBids.length === 1 ? "" : "s"}, and ${bidder.openTenders.length} tender${bidder.openTenders.length === 1 ? " is" : "s are"} open.`] : []),
      ];
      return `${parts.join(" ")} ${helpText(sides).split("\n").slice(2).filter((l) => l.startsWith("/")).map((l) => l.split("  ")[0]).join(", ")} show more.`.trim();
    };
    const r = await chatAsAgent(text, [...(owner ? ["tender owner"] : []), ...(bidder ? ["bidder"] : [])], snapshot, fixture);
    return { text: r.value };
  } catch (error) {
    log.warn("chat agent failed", { error: error instanceof Error ? error.message : String(error) });
    return { text: helpText(sides) };
  }
}

async function ownerSnapshot(accountId: string) {
  const tenders = await db.tender.findMany({
    where: { buyerId: accountId, status: { notIn: ["DRAFT"] } },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      title: true,
      status: true,
      closesAt: true,
      budgetCents: true,
      currency: true,
      _count: { select: { bids: true } },
      questions: { orderBy: { askedAt: "asc" }, take: 10, select: { question: true, answer: true, answeredBy: true } },
    },
  });
  const summaries = await Promise.all(tenders.map((t) => latestOwnerSummary(t.id)));
  return {
    tenders: tenders.map((t, i) => ({
      title: t.title,
      status: ownerStatus(t.status, t._count.bids),
      closes: dayTime(t.closesAt.toISOString()),
      budget: money(t.budgetCents, t.currency),
      // The count only: who bid and at what price stay sealed until close, and are in the website after.
      bids: t._count.bids,
      bidderQuestions: t.questions.map((q) => ({ question: q.question, answer: q.answer, answeredBy: q.answer ? (q.answeredBy === "buyer" ? "you" : "your agent") : "waiting for you" })),
      agentSummary: summaries[i]?.summary ?? null,
    })),
  };
}

async function bidderSnapshot(sellerId: string) {
  const [s, open, bids, waiting] = await Promise.all([
    db.seller.findUnique({ where: { id: sellerId }, select: { agentOn: true, agentBrief: true } }),
    db.tender.findMany({
      where: { status: "OPEN", closesAt: { gt: new Date() } },
      orderBy: { closesAt: "asc" },
      take: 8,
      select: { title: true, spec: true, budgetCents: true, currency: true, destinationCountry: true, closesAt: true, bids: { where: { sellerId }, select: { id: true } } },
    }),
    db.bid.findMany({
      where: { sellerId },
      orderBy: { submittedAt: "desc" },
      take: 8,
      select: { id: true, leadTimeDays: true, lines: { select: { amountCents: true } }, tender: { select: { title: true, status: true, currency: true, award: { select: { bidId: true } } } } },
    }),
    waitingClarifications(sellerId),
  ]);
  return {
    agent: { on: Boolean(s?.agentOn), whatItKnows: (s?.agentBrief ?? "").slice(0, 600) },
    openTenders: open.map((t) => {
      const spec = (t.spec ?? {}) as { item?: string; quantity?: number; deliveryDays?: number };
      return {
        title: t.title,
        item: spec.item ?? t.title,
        quantity: spec.quantity ?? null,
        deliveryDays: spec.deliveryDays ?? null,
        deliverTo: countryName(t.destinationCountry),
        budget: money(t.budgetCents, t.currency),
        closes: dayTime(t.closesAt.toISOString()),
        youBid: t.bids.length > 0,
      };
    }),
    // Their own bids only: they may see their own prices, never anyone else's.
    myBids: bids.map((b) => ({
      tender: b.tender.title,
      status: bidStatus(b.tender.status, b.tender.award ? b.tender.award.bidId === b.id : null),
      yourBidBeforeDutyAndVat: money(b.lines.reduce((x, l) => x + l.amountCents, 0), b.tender.currency),
      leadTimeDays: b.leadTimeDays,
    })),
    tenderOwnerQuestionsWaitingForYou: waiting,
  };
}
