// FairBid's seven AI roles. Each takes plain inputs, returns checked JSON, and has a
// fixture used when the AI is off or a call fails (src/lib/ai/model.ts).
// Server only. Nothing here touches the database: workflow.ts reads and writes.

import { z } from "zod";
import { clampDraft, draftFrom, type Draft } from "../draft";
import { runRole, type AiResult, type UserPart } from "./model";
import { answerFromBrief, MAX_BRIEF, planFromBrief, questionFromBrief, type AgentPlan, type BriefTender } from "../agents/brief";
import {
  AGENT_ANSWERER,
  BLIND_SCORER,
  BUYER_ANSWERER,
  COLLUSION_REASONER,
  HS_CLASSIFIER,
  PROPOSAL_REVIEWER,
  SELLER_AGENT,
  TENDER_WRITER,
} from "./prompts";

// ── 1. Tender writer ─────────────────────────────────────────────────────────

export const DraftSchema = z.object({
  title: z.string(),
  item: z.string(),
  quantity: z.number(),
  budget: z.number(),
  destination: z.enum(["DE", "US"]),
  deliveryDays: z.number(),
  questions: z.array(z.string()),
});

export async function writeTender(need: string): Promise<AiResult<Draft>> {
  const r = await runRole(
    { role: "tender_writer", system: TENDER_WRITER, user: `The buyer wrote:\n\n${need}`, schema: DraftSchema, effort: "low" },
    () => draftFrom(need),
  );
  // Whatever the model said, the draft is brought inside the limits the server enforces.
  return { ...r, value: clampDraft(r.value) };
}

// ── 2. HS classifier ─────────────────────────────────────────────────────────

const HS_CODE = /^\d{4}\.\d{2}$/;

export const HsSchema = z.object({
  hsCode: z.string(),
  description: z.string(),
  confidence: z.number(),
  alternatives: z.array(z.object({ hsCode: z.string(), description: z.string() })),
  reason: z.string(),
});
export type HsGuess = z.infer<typeof HsSchema>;

/** The demo product, cotton table linen. */
export const HS_FIXTURE: HsGuess = {
  hsCode: "6302.51",
  description: "Table linen of cotton",
  confidence: 0.92,
  alternatives: [
    { hsCode: "6302.53", description: "Table linen of man-made fibres" },
    { hsCode: "6304.92", description: "Other furnishing articles of cotton, not knitted" },
  ],
  reason: "Cotton napkins are table linen; the material decides the subheading.",
};

/** Below this, the seller must choose the code; the UI never preselects it. */
export const HS_CONFIDENCE_GATE = 0.7;

export async function classifyHs(product: string): Promise<AiResult<HsGuess>> {
  const r = await runRole(
    { role: "hs_classifier", system: HS_CLASSIFIER, user: `Product: ${product}`, schema: HsSchema, effort: "low" },
    () => HS_FIXTURE,
  );
  const v = r.value;
  // A malformed code is worse than the fixture: duty would be priced on nothing.
  if (!HS_CODE.test(v.hsCode)) return { value: HS_FIXTURE, source: "fixture" };
  return {
    ...r,
    value: {
      ...v,
      confidence: Math.min(1, Math.max(0, v.confidence)),
      alternatives: v.alternatives.filter((a) => HS_CODE.test(a.hsCode) && a.hsCode !== v.hsCode).slice(0, 2),
    },
  };
}

// ── 3. Proposal reviewer ─────────────────────────────────────────────────────

export interface ReviewBid {
  letter: string;
  notes: string;
  hsCode: string | null;
  leadTimeDays: number;
  photoCount: number;
}

export interface ReviewInput {
  title: string;
  needText: string;
  deliveryDays: number;
  criteria: { name: string; weightPct: number; rubric: string }[];
  bids: ReviewBid[];
}

export const ReviewSchema = z.object({
  questions: z.array(z.object({ topic: z.string(), question: z.string(), bids: z.array(z.string()) })),
});
export type ReviewQuestion = z.infer<typeof ReviewSchema>["questions"][number];

const PRICE_LOCK = "Your price cannot change.";

/** Questions for the sellers after close, each sent to every bid with the same gap. */
export async function reviewProposals(input: ReviewInput, fixture: () => ReviewQuestion[]): Promise<AiResult<ReviewQuestion[]>> {
  const r = await runRole(
    {
      role: "proposal_reviewer",
      system: PROPOSAL_REVIEWER,
      user: JSON.stringify(input, null, 1),
      schema: ReviewSchema,
      effort: "low",
    },
    () => ({ questions: fixture() }),
  );
  const letters = new Set(input.bids.map((b) => b.letter));
  const questions = r.value.questions
    .map((q) => ({
      topic: q.topic.trim().slice(0, 80),
      // Every question carries the price lock, worded once, by code.
      question: `${q.question.trim().replace(/\s*your price cannot change\.?$/i, "")} ${PRICE_LOCK}`.slice(0, 600),
      bids: [...new Set(q.bids.map((b) => b.trim().toUpperCase()))].filter((b) => letters.has(b)),
    }))
    .filter((q) => q.bids.length > 0 && q.question.length > PRICE_LOCK.length + 10)
    .slice(0, 3);
  return { ...r, value: questions };
}

// ── 4. Blind scorer ──────────────────────────────────────────────────────────

export interface ScoreInput {
  tender: { title: string; needText: string };
  /** Only the criteria the model judges. Cost and lead time are scored in code. */
  criteria: { name: string; rubric: string }[];
  bid: { notes: string; hsCode: string | null; leadTimeDays: number; photos: string[] };
  /** Clarifications this bid was asked, with its answer if any. */
  clarifications: { question: string; reply: string | null }[];
}

export const ScoreSchema = z.object({
  scores: z.array(z.object({ criterion: z.string(), score: z.number(), reason: z.string() })),
});
export type CriterionScore = { score: number; reason: string };

const RASTER = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/;

/** Scores one anonymous bid on the judged criteria. Missing criteria fall back one by one. */
export async function scoreBlind(
  input: ScoreInput,
  fixture: (criterion: string) => CriterionScore,
): Promise<AiResult<Record<string, CriterionScore>>> {
  // Up to two real photos go along; the drawn SVG placeholders carry no evidence.
  const images: UserPart[] = input.bid.photos
    .map((p) => RASTER.exec(p))
    .filter((m): m is RegExpExecArray => m !== null)
    .slice(0, 2)
    .map((m) => ({ image: { mimeType: m[1] as "image/jpeg" | "image/png" | "image/webp", data: m[2] } }));
  const text = JSON.stringify(
    {
      tender: input.tender,
      criteria: input.criteria,
      bid: { notes: input.bid.notes, hsCode: input.bid.hsCode, leadTimeDays: input.bid.leadTimeDays, photoCount: input.bid.photos.length },
      clarifications: input.clarifications,
    },
    null,
    1,
  );
  const fallback = () => ({ scores: input.criteria.map((c) => ({ criterion: c.name, ...fixture(c.name) })) });
  const r = await runRole(
    {
      role: "blind_scorer",
      system: BLIND_SCORER,
      user: [...images, { text }],
      schema: ScoreSchema,
      effort: "low",
    },
    fallback,
  );
  const byName = new Map(r.value.scores.map((s) => [s.criterion.trim().toLowerCase(), s]));
  const out: Record<string, CriterionScore> = {};
  let usedFixture = r.source === "fixture";
  for (const c of input.criteria) {
    const s = byName.get(c.name.toLowerCase());
    if (s && Number.isFinite(s.score) && s.reason.trim()) {
      out[c.name] = { score: Math.round(Math.min(100, Math.max(0, s.score))), reason: s.reason.trim().slice(0, 300) };
    } else {
      out[c.name] = fixture(c.name);
      usedFixture = true;
    }
  }
  return { value: out, source: usedFixture ? "fixture" : "model" };
}

// ── 5. Collusion reasoner ────────────────────────────────────────────────────

export interface PairInput {
  letters: [string, string];
  evidence: string[];
  notes: [string, string];
}

export const ReasonSchema = z.object({ reason: z.string() });

export const PAIR_FIXTURE = "These two bids look coordinated. A person should look before awarding.";

/** One or two sentences on why code paired two bids. The pairing itself is never the model's. */
export async function explainPair(input: PairInput): Promise<AiResult<string>> {
  const r = await runRole(
    { role: "collusion_reasoner", system: COLLUSION_REASONER, user: JSON.stringify(input, null, 1), schema: ReasonSchema, effort: "low" },
    () => ({ reason: PAIR_FIXTURE }),
  );
  const reason = r.value.reason.trim().slice(0, 400);
  return reason ? { value: reason, source: r.source } : { value: PAIR_FIXTURE, source: "fixture" };
}

// ── 6. Buyer answerer ────────────────────────────────────────────────────────

/** The tender as published: the only thing the buyer's AI may answer from. */
export interface PublishedTender {
  title: string;
  needText: string;
  spec: { item: string; quantity: number; deliverTo: string; deliveryDays: number };
  criteria: { name: string; weightPct: number; rubric: string }[];
  budgetCents: number;
  currency: string;
  destinationCountry: string;
  closesAt: string;
  referencePhotoCount: number;
}

export const AnswerSchema = z.object({ answerable: z.boolean(), answer: z.string() });
export type BuyerAnswer = z.infer<typeof AnswerSchema>;

const NOT_ANSWERABLE: BuyerAnswer = { answerable: false, answer: "" };

const units = (cents: number, currency: string) =>
  `${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;

/**
 * The scripted answerer: a few plain facts the published tender settles, found by keyword.
 * Anything else, and anything about other bids or sellers, waits for the buyer.
 */
export function answerFromTender(question: string, t: PublishedTender): BuyerAnswer {
  const q = question.toLowerCase();
  if (/\b(other|another|competing)\s+(bids?|sellers?|offers?|quotes?)\b|competitor|lowest bid|who else|how many (bids|sellers)/.test(q)) {
    return NOT_ANSWERABLE;
  }
  if (/criteri|scor(e|ed|ing)|weight|judg|evaluat|\brank/.test(q)) {
    const list = t.criteria.map((c) => `${c.name} ${c.weightPct}%`).join(", ");
    return list ? { answerable: true, answer: `Bids are scored on ${list}. Cost is compared at the price delivered to the buyer's door.` } : NOT_ANSWERABLE;
  }
  if (/budget|how much|maximum price|max price|spend/.test(q)) {
    return { answerable: true, answer: `The published budget is ${units(t.budgetCents, t.currency)} for the whole order. Bids are compared at delivered cost.` };
  }
  if (/deadline|how long|how many days|lead time|by when|\bwhen\b|\bdays?\b|\bweeks?\b/.test(q)) {
    return { answerable: true, answer: `Delivery is needed within ${t.spec.deliveryDays} days of bidding closing. Bidding closes on ${t.closesAt.slice(0, 10)}.` };
  }
  if (/\bwhere\b|address|destination|deliver(ed|y)? to|ship(ped)? to|location|\bcity\b/.test(q)) {
    const place = t.spec.deliverTo.includes(t.destinationCountry) ? t.spec.deliverTo : `${t.spec.deliverTo}, ${t.destinationCountry}`;
    return t.spec.deliverTo ? { answerable: true, answer: `Delivery is to ${place}.` } : NOT_ANSWERABLE;
  }
  if (/how many|quantity|pieces|\bunits\b|\bpcs\b|number of/.test(q)) {
    return t.spec.quantity > 0 ? { answerable: true, answer: `The tender asks for ${t.spec.quantity} × ${t.spec.item}.` } : NOT_ANSWERABLE;
  }
  return NOT_ANSWERABLE;
}

/** Answers a seller's question from the published tender, or says it has to wait for the buyer. */
export async function answerAsBuyer(question: string, tender: PublishedTender): Promise<AiResult<BuyerAnswer>> {
  const r = await runRole(
    { role: "buyer_answerer", system: BUYER_ANSWERER, user: JSON.stringify({ tender, question }, null, 1), schema: AnswerSchema, effort: "low" },
    () => answerFromTender(question, tender),
  );
  const answer = r.value.answer.trim().slice(0, 800);
  return { ...r, value: r.value.answerable && answer ? { answerable: true, answer } : NOT_ANSWERABLE };
}

// ── 7. Seller agent ──────────────────────────────────────────────────────────

export const AgentBidSchema = z.object({
  bid: z.boolean(),
  reason: z.string(),
  unitPrice: z.number(),
  shipping: z.number(),
  fees: z.number(),
  leadTimeDays: z.number(),
  notes: z.string(),
  /** One short question to the tender owner for a gap the tender leaves; empty when none. */
  question: z.string().optional(),
});

const toCents = (units: number) => Math.round(units * 100);
const FIXTURE_MARK = "__fixture__";

/** A question and its published answer on the tender, as every bidder sees it. */
export interface PublishedAnswer {
  question: string;
  answer: string;
}

/** The agent's plan for a tender and, when the tender leaves a gap, one question for its owner. */
export interface AgentPlanWithQuestion {
  plan: AgentPlan;
  question: string | null;
}

// A question about money or other bidders is never the agent's to ask.
const OFF_LIMITS = /\b(price|prices|cost|budget|discount|cheaper|other (?:bids?|bidders?|sellers?)|competitors?|how many (?:bids?|bidders?|sellers?))\b/i;

/** Pure: the model's question, tidied, or null when it is empty, too short or long, or off limits. */
export function tidyAgentQuestion(raw: unknown): string | null {
  const q = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (q.length < 10 || q.length > 300 || OFF_LIMITS.test(q)) return null;
  return q;
}

/** Whether a seller's brief fits a tender, and the bid if it does. The model reads the brief;
 * code multiplies the unit price by the quantity and checks every amount and the window.
 * Published answers on the tender are part of what the agent reads. */
export async function planAgentBid(brief: string, tender: BriefTender, answers: PublishedAnswer[] = []): Promise<AiResult<AgentPlanWithQuestion>> {
  const text = brief.trim().slice(0, MAX_BRIEF);
  const published = answers.flatMap((a) => [a.question, a.answer]);
  const fixture = (): AiResult<AgentPlanWithQuestion> => ({
    value: { plan: planFromBrief(text, tender), question: questionFromBrief(text, tender, published) },
    source: "fixture",
  });
  const r = await runRole(
    {
      role: "seller_agent",
      system: SELLER_AGENT,
      user: JSON.stringify({ sellerDescription: text, tender, publishedAnswers: answers }, null, 1),
      schema: AgentBidSchema,
      effort: "low",
    },
    // A marker: the deterministic plan below replaces it.
    () => ({ bid: false, reason: FIXTURE_MARK, unitPrice: 0, shipping: 0, fees: 0, leadTimeDays: 0, notes: "" }),
  );
  if (r.source === "fixture") return fixture();
  const v = r.value;
  const question = tidyAgentQuestion(v.question);
  const reason = v.reason.trim().slice(0, 300) || "Not a fit for what you make.";
  if (!v.bid) return { value: { plan: { kind: "skip", reason }, question }, source: "model" };
  const quantity = Math.max(1, Math.round(tender.quantity));
  const unit = toCents(v.unitPrice);
  const window = Math.max(1, Math.round(tender.deliveryDays));
  const lead = Math.round(v.leadTimeDays);
  // An answer that breaks a rule code can check is not trusted: the deterministic plan decides instead.
  if (!(unit > 0) || !(v.shipping >= 0) || !(v.fees >= 0) || !(lead >= 1)) return fixture();
  if (lead > window) {
    return { value: { plan: { kind: "skip", reason: `You need about ${lead} days; the tender owner wants delivery within ${window}.` }, question }, source: "model" };
  }
  return {
    value: {
      plan: {
        kind: "bid",
        goodsCents: unit * quantity,
        shippingCents: toCents(v.shipping),
        feesCents: toCents(v.fees),
        leadTimeDays: lead,
        notes: (v.notes.trim() || text).slice(0, 500),
      },
      question,
    },
    source: "model",
  };
}

// ── 7. Agent answerer ────────────────────────────────────────────────────────

export const AgentAnswerSchema = z.object({ answerable: z.boolean(), answer: z.string() });

/** A buyer's question answered from the seller's brief, or null to leave it for the seller. */
export async function answerFromSellerBrief(brief: string, question: string): Promise<AiResult<string | null>> {
  const text = brief.trim().slice(0, MAX_BRIEF);
  const r = await runRole(
    {
      role: "agent_answerer",
      system: AGENT_ANSWERER,
      user: JSON.stringify({ sellerDescription: text, buyerQuestion: question }, null, 1),
      schema: AgentAnswerSchema,
      effort: "low",
    },
    () => {
      const a = answerFromBrief(text, question);
      return { answerable: a !== null, answer: a ?? "" };
    },
  );
  const answer = r.value.answer.trim().slice(0, 1000);
  return { value: r.value.answerable && answer ? answer : null, source: r.source };
}
