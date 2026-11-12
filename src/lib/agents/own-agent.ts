// FairBid's own bidding agent for a seller. The seller writes, in plain words, what they
// make and sell (Seller.agentBrief) and switches it on (Seller.agentOn). From then on the
// agent reads each open tender, bids when the brief fits it, and answers buyers'
// questions the brief covers. Server only.
//
// It never takes a shortcut: a bid goes through the same submitBid the MCP submit_bid tool
// and the seller's own form call, so it is sealed and checked exactly like theirs, and an
// answer goes through addReply, which can never change a price. Every step is signed in the
// event log as agent:<sellerId>, the actor MCP agent bids carry. Sealed prices never go in
// the log: the panel reads the bidder's own bid for the amount.

import { appendEvent } from "../audit-store";
import {
  MAX_TURNS,
  answerFromSellerBrief,
  bidderAgentTurn,
  classifyHs,
  planAgentBid,
  summarizeForBidder,
  type ConversationTurn,
  type PublishedAnswer,
} from "../ai/roles";
import { db } from "../db";
import { money } from "../format";
import { log } from "../log";
import { askTenderQuestion, canAskMore, listTenderQuestions, type PublishedQuestion } from "../tender-questions";
import { StepError, addReply, submitBid } from "../workflow";
import type { BriefTender } from "./brief";

export const agentActor = (sellerId: string) => `agent:${sellerId}`;

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** What the agent did, as the event log records it. */
export const AGENT_KINDS = ["agent.bid", "agent.skipped", "agent.answered", "agent.deferred", "agent.asked", "agent.rechecked", "agent.summary"] as const;
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

/** The published answers on a tender, as the agent reads them. */
const answersOf = (questions: PublishedQuestion[]): PublishedAnswer[] =>
  questions.filter((q) => q.answer).map((q) => ({ question: q.question, answer: q.answer! }));

const sameQuestion = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Asks the tender owner one of the agent's questions: never one already asked on the tender,
 * within the per-bidder cap and at most MAX_TURNS per tender per version of the brief. Returns
 * the published question, or null when it did not ask. Never throws for a refused question.
 */
async function askOnce(
  seller: { id: string; since: Date | null },
  tenderId: string,
  question: string,
  questions: PublishedQuestion[],
  ai: string,
  steps: AgentStep[],
): Promise<PublishedQuestion | null> {
  if (!canAskMore(questions.filter((q) => q.mine).length)) return null;
  if (questions.some((q) => sameQuestion(q.question, question))) return null;
  const already = await db.event.count({
    where: { tenderId, actor: agentActor(seller.id), kind: "agent.asked", ...(seller.since ? { at: { gte: seller.since } } : {}) },
  });
  if (already >= MAX_TURNS) return null;
  try {
    const q = await askTenderQuestion({ tenderId, sellerId: seller.id, question, via: "agent" });
    // The question id and whether it was answered: never a price.
    await record(
      tenderId,
      seller.id,
      "agent.asked",
      { questionId: q.id, answered: Boolean(q.answer), ai },
      steps,
      q.answer ? `Answered by their AI: ${q.answer}` : "Waiting for the tender owner; your agent will check the answer",
    );
    return q;
  } catch (error) {
    if (error instanceof StepError) {
      log.warn("own agent could not ask", { sellerId: seller.id, tenderId, error: error.message });
      return null;
    }
    throw error;
  }
}

/**
 * The clarification round: up to MAX_TURNS questions from the bidder's agent, each answered by
 * the tender owner's AI from the published tender when it can. It stops when the agent has
 * enough, or when a question waits for the tender owner. Clarification only: a question about
 * prices or other bids is dropped before it is asked.
 */
async function converse(
  seller: { id: string; agentBrief: string; since: Date | null },
  tenderId: string,
  bt: BriefTender,
  steps: AgentStep[],
): Promise<{ turns: ConversationTurn[]; questionIds: string[] }> {
  const turns: ConversationTurn[] = [];
  const questionIds: string[] = [];
  while (turns.length < MAX_TURNS) {
    const questions = await listTenderQuestions(tenderId, seller.id);
    const next = await bidderAgentTurn(seller.agentBrief, bt, answersOf(questions), turns);
    if (!next.value) break;
    const asked = await askOnce(seller, tenderId, next.value, questions, next.source, steps);
    if (!asked) break;
    questionIds.push(asked.id);
    turns.push({ question: asked.question, answer: asked.answer, answeredBy: asked.answeredBy });
    if (!asked.answer) break;
  }
  return { turns, questionIds };
}

/** Looks at one open tender for one seller: when it fits, talks with the tender owner's AI about
 * what the tender leaves out, then bids from the answers or skips, and sums it up for the
 * bidder. A question still waiting does not hold up the bid: a bid can be replaced while
 * bidding is open, and a later run reads the answer. Never throws. */
async function workTender(
  seller: { id: string; agentBrief: string; since: Date | null },
  tender: { id: string; title: string; needText: string; spec: unknown },
  steps: AgentStep[],
): Promise<void> {
  let talk: { turns: ConversationTurn[]; questionIds: string[] } = { turns: [], questionIds: [] };
  let outcome: { bid: true } | { bid: false; reason: string } | null = null;
  try {
    const bt = briefTender(tender);
    let plan = await planAgentBid(seller.agentBrief, bt, answersOf(await listTenderQuestions(tender.id, seller.id)));
    if (plan.value.kind === "bid") {
      talk = await converse(seller, tender.id, bt, steps);
      // Answers came in: plan again with them in hand.
      if (talk.turns.some((t) => t.answer)) plan = await planAgentBid(seller.agentBrief, bt, answersOf(await listTenderQuestions(tender.id, seller.id)));
    }
    if (plan.value.kind === "skip") {
      await record(tender.id, seller.id, "agent.skipped", { reason: plan.value.reason, ai: plan.source }, steps, plan.value.reason);
      if (talk.turns.length) outcome = { bid: false, reason: plan.value.reason };
      return;
    }
    const photos = await latestPhotos(seller.id);
    if (photos.length === 0) {
      const reason = "A bid needs a photo: bid once yourself and your agent reuses that bid's photos.";
      await record(tender.id, seller.id, "agent.skipped", { reason, ai: plan.source }, steps, reason);
      outcome = { bid: false, reason };
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
    outcome = { bid: true };
  } catch (error) {
    if (error instanceof StepError) {
      const reason = `Could not bid: ${error.message}`;
      await record(tender.id, seller.id, "agent.skipped", { reason }, steps, reason).catch(() => {});
      outcome = { bid: false, reason };
    } else {
      log.error("own agent failed on a tender", error, { sellerId: seller.id, tenderId: tender.id });
    }
  } finally {
    if (outcome) {
      try {
        const s = await summarizeForBidder(tender.title, talk.turns, outcome);
        // The summary and the questions it covers. Never a price: the tender owner reads this log too.
        await record(tender.id, seller.id, "agent.summary", { summary: s.value, questionIds: talk.questionIds, ai: s.source }, steps, s.value);
      } catch (error) {
        log.error("own agent summary failed", error, { sellerId: seller.id, tenderId: tender.id });
      }
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
    const brief = { id: seller.id, agentBrief: seller.agentBrief, since: seller.agentUpdatedAt };
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
    await recheckAnswers(brief, steps, opts.tenderIds);
    steps.push(...(await answerQuestionsFor(seller.id, opts.tenderIds)));
  } catch (error) {
    log.error("own agent run failed", error, { sellerId });
  } finally {
    running.delete(sellerId);
  }
  return steps;
}

/**
 * The tender owner answered a question the agent asked after it bid: it plans again with the
 * answer and replaces its bid only when the plan changes. Each answer is read once. With the
 * AI off the deterministic plan cannot read an answer, so the bid stands. Never throws.
 */
async function recheckAnswers(seller: { id: string; agentBrief: string }, steps: AgentStep[], tenderIds?: string[]): Promise<void> {
  try {
    const now = new Date();
    const asked = await db.event.findMany({
      where: {
        actor: agentActor(seller.id),
        kind: { in: ["agent.asked", "agent.rechecked"] },
        tender: { status: "OPEN", closesAt: { gt: now }, ...(tenderIds ? { id: { in: tenderIds } } : {}) },
      },
      select: { tenderId: true, kind: true, payload: true },
    });
    const done = new Set(asked.filter((e) => e.kind === "agent.rechecked").map((e) => (e.payload as { questionId?: string })?.questionId));
    const pending = asked.filter((e) => e.kind === "agent.asked").map((e) => ({ tenderId: e.tenderId, questionId: (e.payload as { questionId?: string })?.questionId }));
    for (const { tenderId, questionId } of pending) {
      if (!questionId || done.has(questionId)) continue;
      const questions = await listTenderQuestions(tenderId, seller.id);
      const q = questions.find((x) => x.id === questionId);
      if (!q?.answer || !q.answeredAt) continue;
      const bid = await db.bid.findUnique({
        where: { tenderId_sellerId: { tenderId, sellerId: seller.id } },
        select: { submittedAt: true, leadTimeDays: true, hsCode: true, photos: true, lines: { select: { kind: true, amountCents: true } } },
      });
      // No bid yet: the next look at the tender reads the answer. A bid made after the answer already read it.
      if (!bid || bid.submittedAt >= new Date(q.answeredAt)) continue;
      const tender = await db.tender.findUnique({ where: { id: tenderId }, select: { title: true, needText: true, spec: true } });
      if (!tender) continue;
      const planned = await planAgentBid(seller.agentBrief, briefTender(tender), answersOf(questions));
      const plan = planned.value;
      const line = (kind: string) => bid.lines.find((l) => l.kind === kind)?.amountCents ?? 0;
      let detail = "Read the tender owner's answer: your bid stands";
      let outcome: "kept" | "replaced" | "check" = "kept";
      if (planned.source === "model" && plan.kind === "skip") {
        outcome = "check";
        detail = `Read the tender owner's answer: it may rule your bid out, check it (${lower(plan.reason)})`;
      } else if (
        planned.source === "model" &&
        plan.kind === "bid" &&
        (plan.goodsCents !== line("goods") || plan.shippingCents !== line("shipping") || plan.feesCents !== line("fees") || plan.leadTimeDays !== bid.leadTimeDays)
      ) {
        const photos = Array.isArray(bid.photos) ? (bid.photos as string[]) : [];
        try {
          await submitBid(
            tenderId,
            seller.id,
            { goodsCents: plan.goodsCents, shippingCents: plan.shippingCents, feesCents: plan.feesCents, leadTimeDays: plan.leadTimeDays, hsCode: bid.hsCode ?? "", notes: plan.notes, photos },
            agentActor(seller.id),
          );
          outcome = "replaced";
          detail = "Read the tender owner's answer and replaced your bid";
        } catch (error) {
          if (!(error instanceof StepError)) throw error;
          outcome = "check";
          detail = `Read the tender owner's answer but could not replace your bid: ${error.message}`;
        }
      }
      // What happened, never a price.
      await record(tenderId, seller.id, "agent.rechecked", { questionId, outcome, ai: planned.source }, steps, detail);
    }
  } catch (error) {
    log.error("own agent recheck failed", error, { sellerId: seller.id });
  }
}

/** The tender owner answered a bidder's question: every agent that asked on that tender reads it. Never throws. */
export async function recheckAgentsForQuestion(questionId: string): Promise<AgentStep[]> {
  try {
    const q = await db.tenderQuestion.findUnique({ where: { id: questionId }, select: { tenderId: true } });
    if (!q) return [];
    const sellers = await db.seller.findMany({
      where: { agentOn: true, agentBrief: { not: null }, bids: { some: { tenderId: q.tenderId } } },
      select: { id: true },
    });
    return (await Promise.all(sellers.map((s) => runOwnAgent(s.id, { tenderIds: [q.tenderId] })))).flat();
  } catch (error) {
    log.error("own agents failed to read an answer", error, { questionId });
    return [];
  }
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
  /** For a summary: the questions it asked, each with its answer or null while it waits. */
  turns?: { question: string; answer: string | null; answeredBy: "ai" | "buyer" | null }[];
}

/** What the seller's own agent did lately, in plain words, for their dashboard only. */
export async function agentActivity(sellerId: string, take = 8): Promise<AgentActivity[]> {
  const events = await db.event.findMany({
    where: { actor: agentActor(sellerId), kind: { in: [...AGENT_KINDS] } },
    orderBy: { at: "desc" },
    take: take * 3,
    select: { id: true, tenderId: true, kind: true, payload: true, at: true, tender: { select: { title: true, currency: true } } },
  });
  const bids = await db.bid.findMany({
    where: { sellerId, tenderId: { in: events.filter((e) => e.kind === "agent.bid" || e.kind === "agent.summary").map((e) => e.tenderId) } },
    select: { tenderId: true, lines: { select: { amountCents: true } } },
  });
  const totalOf = new Map(bids.map((b) => [b.tenderId, b.lines.reduce((s, l) => s + l.amountCents, 0)]));
  // The seller's own questions, read live so a later answer shows.
  const askedIds = events
    .flatMap((e) => {
      const p = (e.payload ?? {}) as { questionId?: unknown; questionIds?: unknown };
      return e.kind === "agent.asked" ? [p.questionId] : e.kind === "agent.summary" && Array.isArray(p.questionIds) ? p.questionIds : [];
    })
    .filter((id): id is string => typeof id === "string");
  const asked = new Map(
    (
      await db.tenderQuestion.findMany({
        where: { id: { in: askedIds }, sellerId },
        select: { id: true, question: true, answer: true, answeredBy: true },
      })
    ).map((q) => [q.id, q]),
  );
  const askedText = (title: string, questionId: unknown) => {
    const q = asked.get(String(questionId));
    if (!q) return `Asked the tender owner a question on ${title}`;
    const answer = !q.answer
      ? "Waiting for the tender owner."
      : `${q.answeredBy === "buyer" ? "Answered by the tender owner" : "Answered by their AI"}: ${q.answer}`;
    return `Asked the tender owner on ${title}: ${q.question} ${answer}`;
  };
  // A summary heads its run on a tender: the asks, the bid and the skip of that run fold into it.
  const summaryAt = new Map<string, Date>();
  for (const e of events) if (e.kind === "agent.summary" && !summaryAt.has(e.tenderId)) summaryAt.set(e.tenderId, e.at);
  const folded = (e: (typeof events)[number]) =>
    ["agent.asked", "agent.bid", "agent.skipped"].includes(e.kind) && summaryAt.has(e.tenderId) && e.at <= summaryAt.get(e.tenderId)!;
  return events.filter((e) => !folded(e)).slice(0, take).map((e) => {
    const p = (e.payload ?? {}) as { reason?: string; questionId?: string; outcome?: string; summary?: string; questionIds?: unknown };
    if (e.kind === "agent.summary") {
      const total = totalOf.get(e.tenderId);
      const turns = (Array.isArray(p.questionIds) ? p.questionIds : [])
        .map((id) => asked.get(String(id)))
        .filter((q): q is NonNullable<typeof q> => Boolean(q))
        .map((q) => ({ question: q.question, answer: q.answer, answeredBy: q.answer ? (q.answeredBy === "buyer" ? ("buyer" as const) : ("ai" as const)) : null }));
      const bid = total !== undefined ? ` Your bid: ${money(total, e.tender.currency)}, before duty and VAT.` : "";
      return { id: e.id, tenderId: e.tenderId, kind: "agent.summary" as const, text: `${e.tender.title}: ${p.summary ?? ""}${bid}`, at: e.at.toISOString(), turns };
    }
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
            ? `Answered a tender owner's question on ${title}`
            : kind === "agent.asked"
              ? askedText(title, p.questionId)
              : kind === "agent.rechecked"
                ? p.outcome === "replaced"
                  ? `Read the tender owner's answer on ${title} and replaced your bid`
                  : p.outcome === "check"
                    ? `Read the tender owner's answer on ${title}: check whether your bid still fits`
                    : `Read the tender owner's answer on ${title}: your bid stands`
                : `Left a tender owner's question on ${title} for you: your description does not cover it`;
    return { id: e.id, tenderId: e.tenderId, kind, text, at: e.at.toISOString() };
  });
}
