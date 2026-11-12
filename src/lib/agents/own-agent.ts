// FairBid's own bidding agent for a seller. The seller writes, in plain words, what they
// make and sell (Seller.agentBrief) and switches it on (Seller.agentOn). From then on the
// agent reads each open tender, bids when the brief fits it, and answers buyers'
// questions the brief covers. Server only.
//
// It never takes a shortcut: a bid goes through the same submitBid the MCP submit_bid tool
// and the seller's own form call, so it is sealed and checked exactly like theirs, and an
// answer goes through addReply, which can never change a price. Every step is signed in the
// event log as agent:<sellerId>, the actor MCP agent bids carry. Sealed prices never go in
// the log: the panel reads the seller's own bid for the amount.

import { appendEvent } from "../audit-store";
import { answerFromSellerBrief, classifyHs, planAgentBid } from "../ai/roles";
import { db } from "../db";
import { money } from "../format";
import { log } from "../log";
import { StepError, addReply, submitBid } from "../workflow";
import type { BriefTender } from "./brief";

export const agentActor = (sellerId: string) => `agent:${sellerId}`;

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** What the agent did, as the event log records it. */
export const AGENT_KINDS = ["agent.bid", "agent.skipped", "agent.answered", "agent.deferred"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export interface AgentStep {
  tenderId: string;
  kind: AgentKind;
  detail: string;
}

// One run per seller at a time in this instance, so a save and a "Run now" do not bid twice.
const running = new Set<string>();

type TenderSpec = { item?: string; quantity?: number; deliveryDays?: number };

function briefTender(t: { title: string; needText: string; spec: unknown }): BriefTender {
  const spec = (t.spec ?? {}) as TenderSpec;
  return {
    title: t.title,
    needText: t.needText,
    item: spec.item ?? t.title,
    quantity: Number(spec.quantity ?? 1),
    deliveryDays: Number(spec.deliveryDays ?? 28),
  };
}

/** The photos of the seller's most recent bid that had any. A bid needs at least one. */
async function latestPhotos(sellerId: string): Promise<string[]> {
  const bids = await db.bid.findMany({ where: { sellerId }, orderBy: { submittedAt: "desc" }, select: { photos: true }, take: 10 });
  for (const b of bids) if (Array.isArray(b.photos) && b.photos.length > 0) return (b.photos as string[]).slice(0, 4);
  return [];
}

async function record(tenderId: string, sellerId: string, kind: AgentKind, payload: Record<string, unknown>, steps: AgentStep[], detail: string) {
  await appendEvent(tenderId, agentActor(sellerId), kind, { sellerId, ...payload });
  steps.push({ tenderId, kind, detail });
}

/** Looks at one open tender for one seller and bids or skips. Never throws. */
async function workTender(
  seller: { id: string; agentBrief: string },
  tender: { id: string; title: string; needText: string; spec: unknown },
  steps: AgentStep[],
): Promise<void> {
  try {
    const plan = await planAgentBid(seller.agentBrief, briefTender(tender));
    if (plan.value.kind === "skip") {
      await record(tender.id, seller.id, "agent.skipped", { reason: plan.value.reason, ai: plan.source }, steps, plan.value.reason);
      return;
    }
    const photos = await latestPhotos(seller.id);
    if (photos.length === 0) {
      const reason = "A bid needs a photo: bid once yourself and your agent reuses that bid's photos.";
      await record(tender.id, seller.id, "agent.skipped", { reason, ai: plan.source }, steps, reason);
      return;
    }
    const hs = await classifyHs(plan.value.notes);
    const p = plan.value;
    await submitBid(
      tender.id,
      seller.id,
      { goodsCents: p.goodsCents, shippingCents: p.shippingCents, feesCents: p.feesCents, leadTimeDays: p.leadTimeDays, hsCode: hs.value.hsCode, notes: p.notes, photos },
      agentActor(seller.id),
    );
    await record(tender.id, seller.id, "agent.bid", { ai: plan.source, hsCode: hs.value.hsCode, hsSource: hs.source }, steps, "sealed");
  } catch (error) {
    if (error instanceof StepError) {
      const reason = `Could not bid: ${error.message}`;
      await record(tender.id, seller.id, "agent.skipped", { reason }, steps, reason);
    } else {
      log.error("own agent failed on a tender", error, { sellerId: seller.id, tenderId: tender.id });
    }
  }
}

/** Runs one seller's agent: over every open tender they have not bid on (or only the ones
 * given), then over buyers' questions waiting for them. A tender the agent already looked at
 * since the brief last changed is not looked at again. Never throws. */
export async function runOwnAgent(sellerId: string, opts: { tenderIds?: string[] } = {}): Promise<AgentStep[]> {
  if (running.has(sellerId)) return [];
  running.add(sellerId);
  const steps: AgentStep[] = [];
  try {
    const seller = await db.seller.findUnique({ where: { id: sellerId }, select: { id: true, agentBrief: true, agentOn: true, agentUpdatedAt: true } });
    if (!seller?.agentOn || !seller.agentBrief?.trim()) return steps;
    const brief = { id: seller.id, agentBrief: seller.agentBrief };
    const tenders = await db.tender.findMany({
      where: {
        status: "OPEN",
        closesAt: { gt: new Date() },
        bids: { none: { sellerId } },
        ...(opts.tenderIds ? { id: { in: opts.tenderIds } } : {}),
      },
      orderBy: { closesAt: "asc" },
      select: { id: true, title: true, needText: true, spec: true },
    });
    const looked = await db.event.findMany({
      where: {
        tenderId: { in: tenders.map((t) => t.id) },
        actor: agentActor(sellerId),
        kind: { in: ["agent.bid", "agent.skipped"] },
        ...(seller.agentUpdatedAt ? { at: { gte: seller.agentUpdatedAt } } : {}),
      },
      select: { tenderId: true },
    });
    const seen = new Set(looked.map((e) => e.tenderId));
    for (const t of tenders) if (!seen.has(t.id)) await workTender(brief, t, steps);
    steps.push(...(await answerQuestionsFor(seller.id, opts.tenderIds)));
  } catch (error) {
    log.error("own agent run failed", error, { sellerId });
  } finally {
    running.delete(sellerId);
  }
  return steps;
}

/** A new tender is open: every seller whose agent is on looks at it. Never throws. */
export async function runAgentsForTender(tenderId: string): Promise<AgentStep[]> {
  try {
    const sellers = await db.seller.findMany({ where: { agentOn: true, agentBrief: { not: null } }, select: { id: true } });
    const all = await Promise.all(sellers.map((s) => runOwnAgent(s.id, { tenderIds: [tenderId] })));
    return all.flat();
  } catch (error) {
    log.error("own agents failed on a new tender", error, { tenderId });
    return [];
  }
}

// Questions are asked after bidding closes and before the award.
const ASKING = ["CLOSED", "REVIEWING", "CLARIFYING", "PRICED", "SCORED"] as const;

/** Answers, for one seller, the buyers' questions their brief covers. A question it does not
 * cover is left for the seller, once, with a note in the log. Never throws. */
export async function answerQuestionsFor(sellerId: string, tenderIds?: string[]): Promise<AgentStep[]> {
  const steps: AgentStep[] = [];
  try {
    const seller = await db.seller.findUnique({ where: { id: sellerId }, select: { agentBrief: true, agentOn: true } });
    if (!seller?.agentOn || !seller.agentBrief?.trim()) return steps;
    const bids = await db.bid.findMany({
      where: { sellerId, tender: { status: { in: [...ASKING] } }, ...(tenderIds ? { tenderId: { in: tenderIds } } : {}) },
      select: { id: true, tenderId: true },
    });
    for (const bid of bids) {
      const questions = await db.clarification.findMany({
        where: { tenderId: bid.tenderId, replies: { none: { bidId: bid.id } } },
        select: { id: true, question: true, sentTo: true },
        orderBy: { sentAt: "asc" },
      });
      const deferred = new Set(
        (
          await db.event.findMany({ where: { tenderId: bid.tenderId, actor: agentActor(sellerId), kind: "agent.deferred" }, select: { payload: true } })
        ).map((e) => (e.payload as { clarificationId?: string })?.clarificationId),
      );
      for (const q of questions) {
        if (!Array.isArray(q.sentTo) || !(q.sentTo as string[]).includes(sellerId) || deferred.has(q.id)) continue;
        try {
          const a = await answerFromSellerBrief(seller.agentBrief, q.question);
          if (a.value === null) {
            await record(bid.tenderId, sellerId, "agent.deferred", { clarificationId: q.id, ai: a.source }, steps, "Your description does not cover it");
            continue;
          }
          await addReply(q.id, bid.id, a.value, agentActor(sellerId));
          await record(bid.tenderId, sellerId, "agent.answered", { clarificationId: q.id, bidId: bid.id, ai: a.source }, steps, a.value);
        } catch (error) {
          log.error("own agent could not answer", error, { sellerId, clarificationId: q.id });
        }
      }
    }
  } catch (error) {
    log.error("own agent answers failed", error, { sellerId });
  }
  return steps;
}

/** A buyer asked questions on this tender: the agents of the sellers asked answer what their brief covers. Never throws. */
export async function answerAgentQuestions(tenderId: string): Promise<AgentStep[]> {
  try {
    const sellers = await db.seller.findMany({ where: { agentOn: true, agentBrief: { not: null }, bids: { some: { tenderId } } }, select: { id: true } });
    return (await Promise.all(sellers.map((s) => answerQuestionsFor(s.id, [tenderId])))).flat();
  } catch (error) {
    log.error("own agents failed to answer", error, { tenderId });
    return [];
  }
}

export interface AgentActivity {
  id: string;
  tenderId: string;
  kind: AgentKind;
  text: string;
  at: string;
}

/** What the seller's own agent did lately, in plain words, for their dashboard only. */
export async function agentActivity(sellerId: string, take = 8): Promise<AgentActivity[]> {
  const events = await db.event.findMany({
    where: { actor: agentActor(sellerId), kind: { in: [...AGENT_KINDS] } },
    orderBy: { at: "desc" },
    take,
    select: { id: true, tenderId: true, kind: true, payload: true, at: true, tender: { select: { title: true, currency: true } } },
  });
  const bids = await db.bid.findMany({
    where: { sellerId, tenderId: { in: events.filter((e) => e.kind === "agent.bid").map((e) => e.tenderId) } },
    select: { tenderId: true, lines: { select: { amountCents: true } } },
  });
  const totalOf = new Map(bids.map((b) => [b.tenderId, b.lines.reduce((s, l) => s + l.amountCents, 0)]));
  return events.map((e) => {
    const p = (e.payload ?? {}) as { reason?: string };
    const title = e.tender.title;
    const kind = e.kind as AgentKind;
    const total = totalOf.get(e.tenderId);
    const text =
      kind === "agent.bid"
        ? total !== undefined
          ? `Bid ${money(total, e.tender.currency)} on ${title}, before duty and VAT`
          : `Bid on ${title}`
        : kind === "agent.skipped"
          ? `Skipped ${title}: ${lower(p.reason ?? "not a fit")}`
          : kind === "agent.answered"
            ? `Answered a buyer's question on ${title}`
            : `Left a buyer's question on ${title} for you: your description does not cover it`;
    return { id: e.id, tenderId: e.tenderId, kind, text, at: e.at.toISOString() };
  });
}
