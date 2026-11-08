"use server";

// Every server action is a public endpoint: each one reads the user from the
// session and checks the role before doing anything (ARCHITECTURE.md).

import { refresh } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { DEMO_TENDER_ID } from "../../prisma/seed-data";
import { DEMO_USERS, type Role, type User } from "@/lib/auth";
import { classifyHs, HS_CONFIDENCE_GATE, HS_FIXTURE, writeTender } from "@/lib/ai/roles";
import { db } from "@/lib/db";
import { draftFrom } from "@/lib/draft";
import { resetDemoTender } from "@/lib/demo-reset";
import { createLimiter } from "@/lib/rate-limit";
import { DEMO_QUESTIONS, SIMULATED_REPLY, SIMULATED_REPLY_GENERIC } from "@/lib/review-fixture";
import { getUser } from "@/lib/session";
import {
  StepError,
  addReply,
  assertOwner,
  askQuestion,
  authorizeAward,
  captureMilestone,
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
  return run(async () => closeBidding(tenderId, (await owner(tenderId)).id));
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
  return run(async () => askQuestion(tenderId, question, bidIds, (await owner(tenderId)).id));
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

export async function scoreAction(tenderId: string) {
  return run(async () => scoreTender(tenderId, (await owner(tenderId)).id));
}

export async function startAwardAction(tenderId: string, bidId: string) {
  return run(async () => startAward(tenderId, bidId, (await owner(tenderId)).id));
}

export async function authorizeAwardAction(tenderId: string, orderId: string) {
  return run(async () => authorizeAward(tenderId, orderId, (await owner(tenderId)).id));
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
  return run(async () => ({ tenderId: await publishTender(input, (await as("buyer")).id) }));
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
