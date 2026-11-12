"use server";

// Every server action is a public endpoint: each one reads the user from the
// session and checks the role before doing anything (ARCHITECTURE.md).

import { refresh } from "next/cache";
import { after } from "next/server";
import { keysBySellerFromEnv, runBots } from "@/lib/agents/bots";
import { MAX_BRIEF } from "@/lib/agents/brief";
import { answerAgentQuestions, runAgentsForTender, runOwnAgent } from "@/lib/agents/own-agent";
import { redirect, unstable_rethrow } from "next/navigation";
import { DEMO_TENDER_ID } from "../../prisma/seed-data";
import { DEMO_USERS, type Role, type User } from "@/lib/auth";
import { classifyHs, HS_CONFIDENCE_GATE, HS_FIXTURE, writeTender } from "@/lib/ai/roles";
import { createBuyerLinkCode, createLinkCode, unlinkBuyerChannel, unlinkChannel, type LinkOffer } from "@/lib/channels";
import { createAgentKey, revokeAgentKey, type AgentKeyView } from "@/lib/mcp/agent-keys";
import { isMessageChannel } from "@/lib/channels/registry";
import { db } from "@/lib/db";
import { draftFrom } from "@/lib/draft";
import { resetDemoTender } from "@/lib/demo-reset";
import { createLimiter } from "@/lib/rate-limit";
import { DEMO_QUESTIONS, SIMULATED_REPLY, SIMULATED_REPLY_GENERIC } from "@/lib/review-fixture";
import { getUser } from "@/lib/session";
import { answerTenderQuestion, askTenderQuestion } from "@/lib/tender-questions";
import {
  StepError,
  addReply,
  assertOwner,
  askQuestion,
  authorizeAward,
  captureMilestone,
  endOrder,
  startHold,
  closeBidding,
  publishTender,
  scoreTender,
  startAward,
  submitBid,
  toResult,
  type BidInput,
  type Result,
  type TenderInput,
} from "@/lib/workflow";

async function as(role: Role): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.role !== role) throw new StepError(`Only the ${role} can do this.`);
  return user;
}

/** The signed-in buyer, after checking they own this tender. */
async function owner(tenderId: string): Promise<User> {
  const user = await as("buyer");
  await assertOwner(tenderId, user.id);
  return user;
}

async function run<T extends object>(fn: () => Promise<T | void>): Promise<Result<T>> {
  try {
    const value = (await fn()) ?? ({} as T);
    refresh();
    return { ok: true, ...value };
  } catch (error) {
    // A redirect (for example to /login) is a thrown signal, not a failure.
    unstable_rethrow(error);
    return toResult(error);
  }
}

export async function closeBiddingAction(tenderId: string) {
  return run(async () => {
    await closeBidding(tenderId, (await owner(tenderId)).id);
    // The review may have sent questions: sellers' own agents answer what their brief covers.
    after(() => answerAgentQuestions(tenderId));
  });
}

/** Demo only: a trader who has not answered yet replies now. */
export async function simulateReplyAction(clarificationId: string, bidId: string) {
  return run(async () => {
    const c = await db.clarification.findUnique({ where: { id: clarificationId }, select: { question: true, tenderId: true } });
    if (!c) throw new StepError("Question not found.");
    const user = await owner(c.tenderId);
    // The scripted handmade question gets the coordinated traders' identical line; anything else a neutral yes.
    const body = c?.question === DEMO_QUESTIONS[0].question ? SIMULATED_REPLY : SIMULATED_REPLY_GENERIC;
    await addReply(clarificationId, bidId, body, user.id);
  });
}

export async function askQuestionAction(tenderId: string, question: string, bidIds: string[]) {
  return run(async () => {
    await askQuestion(tenderId, question, bidIds, (await owner(tenderId)).id);
    after(() => answerAgentQuestions(tenderId));
  });
}

/** The signed-in seller asks the buyer a question on an open tender. Every seller sees the answer. */
export async function askBuyerAction(tenderId: string, question: string) {
  return run(async () => {
    const user = await as("seller");
    return { question: await askTenderQuestion({ tenderId: String(tenderId), sellerId: user.sellerId!, question: String(question), via: "seller" }) };
  });
}

/** The signed-in buyer answers a seller's question on their own tender, for every seller. */
export async function answerSellerQuestionAction(questionId: string, answer: string) {
  return run(async () => {
    const user = await as("buyer");
    return { question: await answerTenderQuestion({ questionId: String(questionId), buyerAccountId: user.id, answer: String(answer) }) };
  });
}

export async function sellerReplyAction(clarificationId: string, body: string) {
  return run(async () => {
    const user = await as("seller");
    const c = await db.clarification.findUnique({ where: { id: clarificationId } });
    const bid = c && (await db.bid.findUnique({ where: { tenderId_sellerId: { tenderId: c.tenderId, sellerId: user.sellerId! } } }));
    if (!bid) throw new StepError("You were not asked this question.");
    await addReply(clarificationId, bid.id, body, user.id);
  });
}

/** The signed-in seller asks for a one-time code to link a chat. */
export async function linkChannelAction(kind: string) {
  return run<{ offer: LinkOffer }>(async () => {
    const user = await as("seller");
    if (!isMessageChannel(kind)) throw new StepError("Unknown channel.");
    if (!linkLimiter.hit(user.id)) throw new StepError("Too many codes requested. Wait a few minutes.");
    return { offer: await createLinkCode(user.sellerId!, kind) };
  });
}

export async function unlinkChannelAction(kind: string) {
  return run(async () => {
    const user = await as("seller");
    if (!isMessageChannel(kind)) throw new StepError("Unknown channel.");
    await unlinkChannel(user.sellerId!, kind);
  });
}

const linkLimiter = createLimiter(10, 10 * 60_000);

/** The signed-in buyer asks for a one-time code to link a Telegram chat for tender updates. */
export async function linkBuyerChannelAction(kind: string) {
  return run<{ offer: LinkOffer }>(async () => {
    const user = await as("buyer");
    if (kind !== "telegram") throw new StepError("Tender owners can link Telegram only.");
    if (!linkLimiter.hit(user.id)) throw new StepError("Too many codes requested. Wait a few minutes.");
    return { offer: await createBuyerLinkCode(user.id, kind) };
  });
}

export async function unlinkBuyerChannelAction(kind: string) {
  return run(async () => {
    const user = await as("buyer");
    if (kind !== "telegram") throw new StepError("Tender owners can link Telegram only.");
    await unlinkBuyerChannel(user.id, kind);
  });
}

/** The signed-in seller makes a key for their own AI agent. The key comes back once. */
export async function createAgentKeyAction(label: string) {
  return run<{ key: string; view: AgentKeyView }>(async () => {
    const user = await as("seller");
    if (!agentKeyLimiter.hit(user.id)) throw new StepError("Too many keys made. Wait a few minutes.");
    return createAgentKey(user.sellerId!, label, { shared: DEMO_USERS.some((u) => u.id === user.id) });
  });
}

export async function revokeAgentKeyAction(id: string) {
  return run(async () => {
    const user = await as("seller");
    await revokeAgentKey(user.sellerId!, id);
  });
}

const agentKeyLimiter = createLimiter(10, 10 * 60_000);

/** The signed-in seller tells FairBid's own agent what they make, and switches it on or off.
 * Switched on, it looks at every open tender right after the response. */
export async function saveAgentBriefAction(brief: string, on: boolean) {
  return run(async () => {
    const user = await as("seller");
    const text = typeof brief === "string" ? brief.trim().slice(0, MAX_BRIEF) : "";
    const enabled = on === true;
    if (enabled && text.length < 20) throw new StepError("Describe what you make in a sentence or more: what it is, the price per piece, shipping and how long it takes.");
    await db.seller.update({ where: { id: user.sellerId! }, data: { agentBrief: text || null, agentOn: enabled, agentUpdatedAt: new Date() } });
    if (enabled) after(() => runOwnAgent(user.sellerId!));
  });
}

const agentRunLimiter = createLimiter(20, 60 * 60_000);

/** "Run now": the seller's own agent looks at open tenders and waiting questions while they wait. */
export async function runAgentNowAction() {
  return run(async () => {
    const user = await as("seller");
    if (!agentRunLimiter.hit(user.id)) throw new StepError("Your agent has run often this hour. Wait a few minutes.");
    const seller = await db.seller.findUnique({ where: { id: user.sellerId! }, select: { agentOn: true, agentBrief: true } });
    if (!seller?.agentOn || !seller.agentBrief) throw new StepError("Switch on \"Bid for me automatically\" and save first.");
    const steps = await runOwnAgent(user.sellerId!);
    return {
      bids: steps.filter((s) => s.kind === "agent.bid").length,
      skipped: steps.filter((s) => s.kind === "agent.skipped").length,
      answers: steps.filter((s) => s.kind === "agent.answered").length,
    };
  });
}

export async function scoreAction(tenderId: string) {
  return run(async () => scoreTender(tenderId, (await owner(tenderId)).id));
}

export async function startAwardAction(tenderId: string, bidId: string, depositAccepted: boolean) {
  return run(async () => startAward(tenderId, bidId, (await owner(tenderId)).id, { depositAccepted: depositAccepted === true }));
}

export async function authorizeAwardAction(tenderId: string, orderId: string) {
  return run(async () => authorizeAward(tenderId, orderId, (await owner(tenderId)).id));
}

/** The next hold of a phased order, or a new hold for a phase whose hold lapsed. */
export async function startHoldAction(tenderId: string) {
  return run(async () => startHold(tenderId, (await owner(tenderId)).id));
}

export async function endOrderAction(tenderId: string) {
  return run(async () => endOrder(tenderId, (await owner(tenderId)).id));
}

export async function payMilestoneAction(tenderId: string, milestoneId: string, amountCents: number) {
  return run(async () => captureMilestone(tenderId, milestoneId, amountCents, (await owner(tenderId)).id));
}

export async function submitBidAction(tenderId: string, input: BidInput) {
  return run(async () => {
    const user = await as("seller");
    await submitBid(tenderId, user.sellerId!, input, user.id);
  });
}

export async function publishTenderAction(input: TenderInput) {
  return run(async () => {
    const tenderId = await publishTender(input, (await as("buyer")).id);
    // Sellers' own agents look at the new tender after the response: a failing agent never slows or breaks publishing.
    after(() => runAgentsForTender(tenderId));
    return { tenderId };
  });
}

// Each AI call costs money, so a person gets a fair number per hour, per instance.
const draftsPerUser = createLimiter(20, 60 * 60_000);
const hsGuessesPerUser = createLimiter(40, 60 * 60_000);

/** The tender writer: plain words in, a draft the buyer edits before publishing. */
export async function draftTenderAction(need: string) {
  return run(async () => {
    const user = await as("buyer");
    const text = need.trim().slice(0, 2000);
    if (text.length < 20) throw new StepError("Write at least a sentence: what, how many, by when and roughly what budget.");
    if (!draftsPerUser.hit(user.id)) return { draft: draftFrom(text), source: "fixture" as const };
    const r = await writeTender(text);
    return { draft: r.value, source: r.source };
  });
}

/** The HS classifier: a seller's product words in, a customs code they confirm or change. */
export async function classifyHsAction(product: string) {
  return run(async () => {
    const user = await as("seller");
    const text = product.trim().slice(0, 500);
    if (text.length < 3) throw new StepError("Describe the product in a few words.");
    if (!hsGuessesPerUser.hit(user.id)) return { guess: HS_FIXTURE, source: "fixture" as const, gate: HS_CONFIDENCE_GATE };
    const r = await classifyHs(text);
    return { guess: r.value, source: r.source, gate: HS_CONFIDENCE_GATE };
  });
}

/** Demo: the four seller agents work this tender over MCP, the same public endpoint any
 * seller's own agent would use. They bid while it is open and answer questions after. */
export async function inviteAgentsAction(tenderId: string) {
  return run(async () => {
    const user = await owner(tenderId);
    // The four agents are scripted: they belong in the demo, never in a real buyer's bids.
    if (!DEMO_USERS.some((u) => u.id === user.id)) throw new StepError("Bidder agents are a demo feature, for the demo accounts only.");
    const keys = keysBySellerFromEnv(process.env.MCP_SELLER_KEYS);
    if (keys.size === 0) throw new StepError("No bidder agents are set up here: MCP_SELLER_KEYS is empty.");
    // The agents call this same server on its loopback address. Never an address taken
    // from the request: a forged Host header would receive the seller keys.
    const steps = await runBots(`http://127.0.0.1:${process.env.PORT ?? 3000}/api/mcp`, keys, tenderId);
    const failed = steps.filter((s) => s.action === "error");
    if (failed.length === steps.length && failed.length > 0) throw new StepError(`The bidder agents could not reach the tender: ${failed[0].detail}`);
    if (!steps.some((s) => s.action === "bid" || s.action === "answer")) throw new StepError("The bidder agents had nothing to do: each has already bid and answered.");
    return { bids: steps.filter((s) => s.action === "bid").length, answers: steps.filter((s) => s.action === "answer").length };
  });
}

/** Rebuilds the demo tender for the next run. Leaves other tenders alone. */
export async function resetDemoAction() {
  return run(async () => {
    const user = await getUser();
    if (!user) redirect("/login");
    // Only the shared demo accounts may rebuild the shared demo tender.
    if (!DEMO_USERS.some((u) => u.id === user.id)) throw new StepError("Only the demo accounts can reset the demo.");
    await resetDemoTender(db);
    return { path: user.role === "buyer" ? `/tender/${DEMO_TENDER_ID}` : "/" };
  });
}
