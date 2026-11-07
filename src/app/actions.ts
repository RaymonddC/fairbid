"use server";

// Every server action is a public endpoint: each one reads the user from the
// session and checks the role before doing anything (ARCHITECTURE.md).

import { refresh } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { DEMO_TENDER_ID } from "../../prisma/seed-data";
import type { Role, User } from "@/lib/auth";
import { db } from "@/lib/db";
import { resetDemoTender } from "@/lib/demo-reset";
import { DEMO_QUESTIONS, SIMULATED_REPLY, SIMULATED_REPLY_GENERIC } from "@/lib/review-fixture";
import { getUser } from "@/lib/session";
import {
  StepError,
  addReply,
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
  return run(async () => closeBidding(tenderId, (await as("buyer")).id));
}

/** Demo only: a trader who has not answered yet replies now. */
export async function simulateReplyAction(clarificationId: string, bidId: string) {
  return run(async () => {
    const user = await as("buyer");
    const c = await db.clarification.findUnique({ where: { id: clarificationId }, select: { question: true } });
    // The scripted handmade question gets the coordinated traders' identical line; anything else a neutral yes.
    const body = c?.question === DEMO_QUESTIONS[0].question ? SIMULATED_REPLY : SIMULATED_REPLY_GENERIC;
    await addReply(clarificationId, bidId, body, user.id);
  });
}

export async function askQuestionAction(tenderId: string, question: string, bidIds: string[]) {
  return run(async () => askQuestion(tenderId, question, bidIds, (await as("buyer")).id));
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
  return run(async () => scoreTender(tenderId, (await as("buyer")).id));
}

export async function startAwardAction(tenderId: string, bidId: string) {
  return run(async () => startAward(tenderId, bidId, (await as("buyer")).id));
}

export async function authorizeAwardAction(tenderId: string, orderId: string) {
  return run(async () => authorizeAward(tenderId, orderId, (await as("buyer")).id));
}

export async function payMilestoneAction(tenderId: string, milestoneId: string, amountCents: number) {
  return run(async () => captureMilestone(tenderId, milestoneId, amountCents, (await as("buyer")).id));
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

/** Rebuilds the demo tender for the next run. Leaves other tenders alone. */
export async function resetDemoAction() {
  return run(async () => {
    const user = await getUser();
    if (!user) redirect("/login");
    await resetDemoTender(db);
    return { path: user.role === "buyer" ? `/tender/${DEMO_TENDER_ID}` : "/" };
  });
}
