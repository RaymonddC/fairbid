// Scoring and the collusion check. Pure and deterministic: the same scores always
// rank the same way (DECISIONS.md, "Deterministic where it matters"). The "reviewed"
// criteria are scored by the AI, blind and with a reason (DECISIONS.md, "The AI scores
// the criteria code cannot"); everything else here is code.

export type CriterionKind = "cost" | "lead_time" | "completeness" | "reviewed";

/** Which rule scores a criterion, from its published name. Cost is checked first,
 * because "Delivered cost" also contains "deliver". */
export function criterionKind(name: string): CriterionKind {
  if (/cost|price/i.test(name)) return "cost";
  if (/lead|deliver|time/i.test(name)) return "lead_time";
  if (/complete/i.test(name)) return "completeness";
  return "reviewed";
}

/** Lowest delivered cost scores 100; others in proportion. */
export function costScore(deliveredCents: number, bestCents: number, currency = "EUR"): { score: number; reason: string } {
  const score = Math.round((bestCents / deliveredCents) * 100);
  return {
    score,
    reason:
      deliveredCents === bestCents
        ? "Lowest delivered cost."
        : `${formatEur(deliveredCents - bestCents, currency)} above the lowest delivered cost.`,
  };
}

/** Inside the window scores 50 to 100, earlier is higher. Late scores 0. */
export function leadTimeScore(days: number, windowDays: number): { score: number; reason: string } {
  if (days > windowDays) return { score: 0, reason: `${days} days, ${days - windowDays} past the ${windowDays}-day window.` };
  const score = Math.round(50 + (50 * (windowDays - days)) / windowDays);
  return { score, reason: `${days} days, ${windowDays - days} inside the ${windowDays}-day window.` };
}

export function completenessScore(bid: { hsCode: string | null; notes: string; photoCount: number }): {
  score: number;
  reason: string;
} {
  const missing = [
    !bid.hsCode && "customs code",
    !bid.notes.trim() && "product description",
    bid.photoCount === 0 && "photos",
  ].filter(Boolean) as string[];
  return missing.length === 0
    ? { score: 100, reason: "Every field filled, customs code confirmed, photos attached." }
    : { score: Math.max(0, 100 - 34 * missing.length), reason: `Missing: ${missing.join(", ")}.` };
}

/** Weighted total out of 100. Weights are whole percents that sum to 100. */
export function weightedTotal(scores: { score: number; weightPct: number }[]): number {
  return scores.reduce((sum, s) => sum + (s.score * s.weightPct) / 100, 0);
}

export interface PairInput {
  id: string;
  goodsCents: number;
  shippingCents: number;
  feesCents: number;
  notes: string;
  submittedAt: Date;
}

export interface CoordinatedPair {
  bidId: string;
  pairedBidId: string;
  /** 0 to 1: how many of the four signals matched. */
  similarity: number;
  evidence: string[];
}

/** Pairs of bids that look coordinated. Flags ask a person to look; they never
 * remove a bid. Two signals or more raise a flag. */
export function findCoordinatedPairs(bids: readonly PairInput[], currency = "EUR"): CoordinatedPair[] {
  const pairs: CoordinatedPair[] = [];
  for (let i = 0; i < bids.length; i++) {
    for (let j = i + 1; j < bids.length; j++) {
      const a = bids[i];
      const b = bids[j];
      const evidence: string[] = [];
      const gap = Math.abs(a.goodsCents - b.goodsCents) / Math.max(a.goodsCents, b.goodsCents);
      if (gap < 0.01) evidence.push(`Quotes differ by ${(gap * 100).toFixed(1)}%`);
      if (a.shippingCents === b.shippingCents && a.feesCents === b.feesCents) {
        evidence.push(`Identical shipping (${formatEur(a.shippingCents, currency)}) and fees (${formatEur(a.feesCents, currency)})`);
      }
      if (normalise(a.notes) === normalise(b.notes)) evidence.push("Same product description, word for word");
      const minutes = Math.abs(a.submittedAt.getTime() - b.submittedAt.getTime()) / 60_000;
      if (minutes > 0 && minutes <= 30) evidence.push(`Submitted ${Math.round(minutes)} minutes apart`);
      if (evidence.length >= 2) {
        pairs.push({ bidId: a.id, pairedBidId: b.id, similarity: Math.min(1, evidence.length / 4), evidence });
      }
    }
  }
  return pairs;
}

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function formatEur(cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IE", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

/** Letters A, B, C… in submission order, so the buyer scores bids blind. */
export const bidLetter = (index: number) => String.fromCharCode(65 + index);
