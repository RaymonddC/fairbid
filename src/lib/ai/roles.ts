// FairBid's five AI roles. Each takes plain inputs, returns checked JSON, and has a
// fixture used when there is no API key or a call fails (src/lib/ai/claude.ts).
// Server only. Nothing here touches the database: workflow.ts reads and writes.

import { z } from "zod";
import { clampDraft, draftFrom, type Draft } from "../draft";
import { runRole, type AiResult, type UserContent } from "./claude";
import { BLIND_SCORER, COLLUSION_REASONER, HS_CLASSIFIER, PROPOSAL_REVIEWER, TENDER_WRITER } from "./prompts";

// ── 1. Tender writer ─────────────────────────────────────────────────────────

const DraftSchema = z.object({
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

const HsSchema = z.object({
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

const ReviewSchema = z.object({
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
      effort: "medium",
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

const ScoreSchema = z.object({
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
  const images: UserContent = input.bid.photos
    .map((p) => RASTER.exec(p))
    .filter((m): m is RegExpExecArray => m !== null)
    .slice(0, 2)
    .map((m) => ({ type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg" | "image/png" | "image/webp", data: m[2] } }));
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
      user: [...images, { type: "text", text }],
      schema: ScoreSchema,
      effort: "medium",
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
  return { value: out, source: usedFixture ? "fixture" : "claude" };
}

// ── 5. Collusion reasoner ────────────────────────────────────────────────────

export interface PairInput {
  letters: [string, string];
  evidence: string[];
  notes: [string, string];
}

const ReasonSchema = z.object({ reason: z.string() });

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
