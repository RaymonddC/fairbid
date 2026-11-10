// Why a losing bid lost. Pure, so the rule is tested: built from the same scores and
// delivered costs the buyer ranked on, after the award is final.
//
// A losing seller sees their own rank, score and delivered cost, and the winning bid's
// delivered cost and score on each criterion. Never the winner's line items, name or
// the reasons written about the winner's product: those stay between buyer and winner
// (DECISIONS.md, "Every losing seller is told why").

import { formatEur, type CriterionKind } from "./scoring";

export interface DebriefBid {
  id: string;
  country: string;
  deliveredCents: number;
  overBudget: boolean;
  /** Weighted total out of 100. */
  total: number | null;
  scores: { criterionId: string; score: number; reason: string }[];
}

export interface DebriefCriterion {
  id: string;
  name: string;
  weightPct: number;
  kind: CriterionKind;
}

export interface DebriefLine {
  name: string;
  weightPct: number;
  kind: CriterionKind;
  myScore: number;
  winnerScore: number;
  /** Weighted points the winner gained over this bid here; negative where this bid was better. */
  pointsBehind: number;
  /** Why this bid scored what it did. */
  myReason: string;
}

export interface Debrief {
  rank: number;
  of: number;
  /** Where the winning bid ranked: the buyer chooses, so it is not always first. */
  winnerRank: number;
  myTotal: number;
  winnerTotal: number;
  myDeliveredCents: number;
  winnerDeliveredCents: number;
  winnerCountry: string;
  overBudget: boolean;
  budgetCents: number;
  currency: string;
  /** Biggest loss first. */
  lines: DebriefLine[];
  /** The criteria that cost the most, up to two, by name. */
  lostOn: string[];
  /** Criteria where this bid beat the winner. */
  beatOn: string[];
  /** The debrief in two to four sentences, as agents read it. */
  summary: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Score order, with bids over budget last, ties to the lower delivered cost. Matches rankBids in views.ts. */
export function rankForDebrief<T extends Pick<DebriefBid, "overBudget" | "total" | "deliveredCents">>(bids: T[]): T[] {
  return [...bids].sort(
    (a, b) => Number(a.overBudget) - Number(b.overBudget) || (b.total ?? 0) - (a.total ?? 0) || a.deliveredCents - b.deliveredCents,
  );
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** The debrief for one losing bid, or null when there is nothing fair to say yet
 * (no scores, or the bid is the winner). */
export function buildDebrief(input: {
  bids: DebriefBid[];
  criteria: DebriefCriterion[];
  myBidId: string;
  winnerBidId: string;
  budgetCents: number;
  currency: string;
}): Debrief | null {
  const { bids, criteria, myBidId, winnerBidId, budgetCents, currency } = input;
  if (myBidId === winnerBidId) return null;
  const mine = bids.find((b) => b.id === myBidId);
  const winner = bids.find((b) => b.id === winnerBidId);
  if (!mine || !winner || mine.total === null || winner.total === null) return null;

  const ranked = rankForDebrief(bids);
  const rank = ranked.findIndex((b) => b.id === myBidId) + 1;
  const winnerRank = ranked.findIndex((b) => b.id === winnerBidId) + 1;

  const scoreOf = (b: DebriefBid, criterionId: string) => b.scores.find((s) => s.criterionId === criterionId);
  const lines: DebriefLine[] = criteria
    .map((c) => {
      const m = scoreOf(mine, c.id);
      const w = scoreOf(winner, c.id);
      if (!m || !w) return null;
      return {
        name: c.name,
        weightPct: c.weightPct,
        kind: c.kind,
        myScore: m.score,
        winnerScore: w.score,
        pointsBehind: round1(((w.score - m.score) * c.weightPct) / 100),
        myReason: m.reason,
      };
    })
    .filter((l): l is DebriefLine => l !== null)
    .sort((a, b) => b.pointsBehind - a.pointsBehind);

  const lostOn = lines.filter((l) => l.pointsBehind > 0).slice(0, 2).map((l) => l.name);
  const beatOn = lines.filter((l) => l.pointsBehind < 0).map((l) => l.name);
  const money = (cents: number) => formatEur(cents, currency);

  const sentences: string[] = [];
  sentences.push(
    `Your bid ranked ${ordinal(rank)} of ${bids.length} with ${round1(mine.total)} points; the winning bid scored ${round1(winner.total)}.`,
  );
  if (mine.overBudget) {
    sentences.push(
      `Your delivered cost, ${money(mine.deliveredCents)}, was over the buyer's ${money(budgetCents)} budget, so it ranked after every bid within budget.`,
    );
  }
  if (lostOn.length) {
    const parts = lines
      .filter((l) => lostOn.includes(l.name))
      .map((l) => `${l.name} (${l.pointsBehind} points behind)`);
    sentences.push(`You lost most ground on ${parts.join(" and ")}.`);
  }
  if (beatOn.length) sentences.push(`You beat the winning bid on ${beatOn.join(" and ")}.`);
  if (winnerRank !== 1) {
    sentences.push(`The buyer chose a bid that ranked ${ordinal(winnerRank)}: FairBid ranks the bids, the buyer decides.`);
  }

  return {
    rank,
    of: bids.length,
    winnerRank,
    myTotal: round1(mine.total),
    winnerTotal: round1(winner.total),
    myDeliveredCents: mine.deliveredCents,
    winnerDeliveredCents: winner.deliveredCents,
    winnerCountry: winner.country,
    overBudget: mine.overBudget,
    budgetCents,
    currency,
    lines,
    lostOn,
    beatOn,
    summary: sentences.join(" "),
  };
}
