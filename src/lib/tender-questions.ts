// Sellers' questions to the buyer on an open tender, like a procurement clarification
// round before bidding. Server only.
//
// The rules: every answer is published to every seller who can see the tender, never
// only to the one who asked. Nobody is told who asked, the buyer included: before close
// the buyer must learn nothing about who is bidding. Questions are taken only while
// bidding is open, a few per seller, and an answer never changes the tender's terms.
// The buyer's AI answers what the published tender already settles; the rest waits for
// the buyer, and onQuestionWaitingForBuyer is called so they can be told.

import { answerAsBuyer, summarizeForOwner, type PublishedTender } from "./ai/roles";
import { appendEvent } from "./audit-store";
import { inBackground, notifyBuyerOfAiAnswer, notifyBuyerOfSellerQuestion } from "./channels/buyer-notify";
import { notifySellerOfAnswer } from "./channels/seller-notify";
import { db } from "./db";
import { log } from "./log";
import { StepError } from "./workflow";

export const QUESTION_MIN = 10;
export const QUESTION_MAX = 500;
export const ANSWER_MAX = 1000;
/** Questions one seller may ask on one tender. */
export const QUESTIONS_PER_SELLER = 5;

/** A question as every seller and the buyer see it: never who asked. */
export interface PublishedQuestion {
  id: string;
  question: string;
  answer: string | null;
  answeredBy: "ai" | "buyer" | null;
  askedAt: string;
  answeredAt: string | null;
  /** Only in the asking seller's own view. */
  mine?: boolean;
}

/** What the buyer is told about a question their AI could not answer. */
export interface WaitingQuestion {
  id: string;
  tenderId: string;
  tenderTitle: string;
  question: string;
  askedAt: string;
}

type Checked = { ok: true; text: string } | { ok: false; error: string };

const tidy = (text: unknown) => (typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "");

/** Pure: a question a seller may send. */
export function checkQuestion(text: unknown): Checked {
  const t = tidy(text);
  if (t.length < QUESTION_MIN) return { ok: false, error: "Write the question in a full sentence." };
  if (t.length > QUESTION_MAX) return { ok: false, error: `Keep the question under ${QUESTION_MAX} characters.` };
  return { ok: true, text: t };
}

/** Pure: an answer the buyer may publish. Line breaks are kept. */
export function checkAnswer(text: unknown): Checked {
  const t = typeof text === "string" ? text.trim() : "";
  if (t.length < 2) return { ok: false, error: "Write the answer first." };
  if (t.length > ANSWER_MAX) return { ok: false, error: `Keep the answer under ${ANSWER_MAX} characters.` };
  return { ok: true, text: t };
}

/** Pure: may this seller ask another question on this tender? */
export function canAskMore(askedSoFar: number): boolean {
  return askedSoFar < QUESTIONS_PER_SELLER;
}

type Row = { id: string; sellerId: string; question: string; answer: string | null; answeredBy: string | null; askedAt: Date; answeredAt: Date | null };

/** Pure: the published view of a stored question. The seller id never leaves here. */
export function publish(row: Row, viewerSellerId?: string): PublishedQuestion {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    answeredBy: row.answer ? (row.answeredBy === "buyer" ? "buyer" : "ai") : null,
    askedAt: row.askedAt.toISOString(),
    answeredAt: row.answeredAt?.toISOString() ?? null,
    ...(viewerSellerId ? { mine: row.sellerId === viewerSellerId } : {}),
  };
}

/**
 * Called whenever a question waits for the buyer because their AI could not answer it from
 * the tender: tells the buyer in their linked chat, in the background, so it never slows or
 * fails the seller's request. It never gets the bidder's identity.
 */
export async function onQuestionWaitingForBuyer(question: WaitingQuestion): Promise<void> {
  inBackground(() => notifyBuyerOfSellerQuestion(question.tenderId, question.id, question.question));
}

const isOpen = (t: { status: string; closesAt: Date }) => t.status === "OPEN" && new Date() < t.closesAt;

function publishedTender(t: {
  title: string;
  needText: string;
  spec: unknown;
  budgetCents: number;
  currency: string;
  destinationCountry: string;
  closesAt: Date;
  photos: unknown;
  criteria: { name: string; weightPct: number; rubric: string }[];
}): PublishedTender {
  const s = (t.spec ?? {}) as Partial<PublishedTender["spec"]>;
  return {
    title: t.title,
    needText: t.needText,
    spec: { item: s.item ?? "", quantity: Number(s.quantity ?? 0), deliverTo: s.deliverTo ?? "", deliveryDays: Number(s.deliveryDays ?? 28) },
    criteria: t.criteria.map((c) => ({ name: c.name, weightPct: c.weightPct, rubric: c.rubric })),
    budgetCents: t.budgetCents,
    currency: t.currency,
    destinationCountry: t.destinationCountry,
    closesAt: t.closesAt.toISOString(),
    referencePhotoCount: Array.isArray(t.photos) ? t.photos.length : 0,
  };
}

/** A seller (or their agent) asks the buyer a question on an open tender. The buyer's AI
 * answers at once when the published tender settles it; otherwise it waits for the buyer. */
export async function askTenderQuestion({
  tenderId,
  sellerId,
  question,
  via,
}: {
  tenderId: string;
  sellerId: string;
  question: string;
  via: "seller" | "agent";
}): Promise<PublishedQuestion> {
  const checked = checkQuestion(question);
  if (!checked.ok) throw new StepError(checked.error);
  const t = await db.tender.findUnique({ where: { id: tenderId }, include: { criteria: { orderBy: { weightPct: "desc" } } } });
  if (!t) throw new StepError("Tender not found.");
  if (!isOpen(t)) throw new StepError("Questions close when bidding closes.");
  const seller = await db.seller.findUnique({ where: { id: sellerId }, select: { id: true } });
  if (!seller) throw new StepError("Only a bidder can ask the tender owner.");
  const asked = await db.tenderQuestion.count({ where: { tenderId, sellerId } });
  if (!canAskMore(asked)) throw new StepError(`You have asked ${QUESTIONS_PER_SELLER} questions on this tender, the most one bidder can.`);

  const row = await db.tenderQuestion.create({ data: { tenderId, sellerId, question: checked.text } });
  // No seller id, not even as the actor: the buyer reads this log while bids are sealed.
  await appendEvent(tenderId, "seller", "question.asked", { questionId: row.id, question: checked.text });
  log.info("tender question asked", { tenderId, questionId: row.id, via });

  let answered: Row = row;
  try {
    const r = await answerAsBuyer(checked.text, publishedTender(t));
    if (r.value.answerable) {
      answered = await db.tenderQuestion.update({
        where: { id: row.id },
        data: { answer: r.value.answer, answeredBy: "ai", answeredAt: new Date() },
      });
      await appendEvent(tenderId, "ai", "question.answered", { questionId: row.id, answeredBy: "ai", source: r.source, answer: r.value.answer });
      // The owner watches the agents talk in their chat: the question and their agent's answer.
      const answer = r.value.answer;
      inBackground(() => notifyBuyerOfAiAnswer(tenderId, checked.text, answer, via === "agent"));
    }
  } catch (error) {
    log.warn("tender owner answerer failed; the question waits for the tender owner", { tenderId, error: (error as Error).message?.slice(0, 200) });
  }
  if (!answered.answer) {
    try {
      await onQuestionWaitingForBuyer({ id: row.id, tenderId, tenderTitle: t.title, question: row.question, askedAt: row.askedAt.toISOString() });
    } catch (error) {
      log.warn("question hook failed", { tenderId, error: (error as Error).message?.slice(0, 200) });
    }
  }
  // The tender owner's summary of what bidders asked, rewritten after the response.
  inBackground(() => refreshOwnerSummary(tenderId));
  return publish(answered, sellerId);
}

/** The buyer answers a waiting question. The answer goes to every seller. */
export async function answerTenderQuestion({
  questionId,
  buyerAccountId,
  answer,
}: {
  questionId: string;
  buyerAccountId: string;
  answer: string;
}): Promise<PublishedQuestion> {
  const checked = checkAnswer(answer);
  if (!checked.ok) throw new StepError(checked.error);
  const q = await db.tenderQuestion.findUnique({ where: { id: questionId }, include: { tender: { select: { buyerId: true, status: true, closesAt: true, title: true } } } });
  if (!q || q.tender.buyerId !== buyerAccountId) throw new StepError("Question not found.");
  if (!isOpen(q.tender)) throw new StepError("Bidding has closed, so this question can no longer be answered.");
  // Only an unanswered question: two answers to the same question would read as two rules.
  const done = await db.tenderQuestion.updateMany({
    where: { id: questionId, answer: null },
    data: { answer: checked.text, answeredBy: "buyer", answeredAt: new Date() },
  });
  if (done.count === 0) throw new StepError("This question already has an answer.");
  await appendEvent(q.tenderId, buyerAccountId, "question.answered", { questionId, answeredBy: "buyer", answer: checked.text });
  const row = await db.tenderQuestion.findUniqueOrThrow({ where: { id: questionId } });
  inBackground(() => refreshOwnerSummary(q.tenderId));
  inBackground(() => notifySellerOfAnswer(q.sellerId, q.tenderId, q.tender.title, q.question, checked.text));
  return publish(row);
}

/** The published questions and answers on a tender, oldest first, without who asked. Pass
 * the viewing seller to mark their own questions in their own view. */
export async function listTenderQuestions(tenderId: string, viewerSellerId?: string): Promise<PublishedQuestion[]> {
  const rows = await db.tenderQuestion.findMany({ where: { tenderId }, orderBy: { askedAt: "asc" } });
  return rows.map((r) => publish(r, viewerSellerId));
}

/**
 * Rewrites the tender owner's summary of what bidders and their agents asked on a tender, and
 * records it as an owner.summary event. No bidder is named: the questions carry no asker, and
 * only the count of sealed bids goes in. Never throws.
 */
export async function refreshOwnerSummary(tenderId: string): Promise<string | null> {
  try {
    const t = await db.tender.findUnique({ where: { id: tenderId }, select: { title: true } });
    if (!t) return null;
    const rows = await db.tenderQuestion.findMany({ where: { tenderId }, orderBy: { askedAt: "asc" }, select: { question: true, answer: true, answeredBy: true } });
    const questions = rows.map((r) => ({ question: r.question, answer: r.answer, answeredBy: r.answer ? (r.answeredBy === "buyer" ? ("buyer" as const) : ("ai" as const)) : null }));
    const sealed = await db.bid.count({ where: { tenderId } });
    const s = await summarizeForOwner(t.title, questions, sealed);
    await appendEvent(tenderId, "ai", "owner.summary", { summary: s.value, source: s.source, questions: questions.length });
    return s.value;
  } catch (error) {
    log.warn("tender owner summary failed", { tenderId, error: (error as Error).message?.slice(0, 200) });
    return null;
  }
}

/** The latest summary for the tender owner, or null when there is none yet. */
export async function latestOwnerSummary(tenderId: string): Promise<{ summary: string; at: string } | null> {
  const e = await db.event.findFirst({ where: { tenderId, kind: "owner.summary" }, orderBy: { seq: "desc" }, select: { payload: true, at: true } });
  const summary = (e?.payload as { summary?: unknown } | undefined)?.summary;
  return e && typeof summary === "string" ? { summary, at: e.at.toISOString() } : null;
}
