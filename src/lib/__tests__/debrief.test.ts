import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDebrief, type DebriefBid, type DebriefCriterion } from "../debrief";

const CRITERIA: DebriefCriterion[] = [
  { id: "cost", name: "Delivered cost", weightPct: 40, kind: "cost" },
  { id: "hand", name: "Handmade proof", weightPct: 25, kind: "reviewed" },
  { id: "lead", name: "Lead time", weightPct: 20, kind: "lead_time" },
  { id: "done", name: "Completeness", weightPct: 15, kind: "completeness" },
];

const bid = (id: string, delivered: number, overBudget: boolean, s: [number, number, number, number], country = "ID"): DebriefBid => {
  const scores = CRITERIA.map((c, i) => ({ criterionId: c.id, score: s[i], reason: `${c.name} reason for ${id}` }));
  return {
    id,
    country,
    deliveredCents: delivered,
    overBudget,
    total: CRITERIA.reduce((t, c, i) => t + (s[i] * c.weightPct) / 100, 0),
    scores,
  };
};

// Close to the demo: D wins, A is the lowest quote but over budget.
const A = bid("A", 305_000, true, [94, 60, 80, 100]);
const B = bid("B", 307_800, true, [94, 70, 70, 100], "VN");
const D = bid("D", 288_000, false, [100, 95, 75, 100]);
const BIDS = [A, B, D];
const base = { bids: BIDS, criteria: CRITERIA, winnerBidId: "D", budgetCents: 300_000, currency: "EUR" };

describe("buildDebrief", () => {
  it("gives the rank, both totals and both delivered costs", () => {
    const d = buildDebrief({ ...base, myBidId: "A" })!;
    assert.equal(d.rank, 3);
    assert.equal(d.of, 3);
    assert.equal(d.winnerRank, 1);
    assert.equal(d.myDeliveredCents, 305_000);
    assert.equal(d.winnerDeliveredCents, 288_000);
    assert.equal(d.winnerTotal, 93.8);
  });

  it("orders the criteria by the points lost, and names the two that cost most", () => {
    const d = buildDebrief({ ...base, myBidId: "A" })!;
    assert.deepEqual(
      d.lines.map((l) => [l.name, l.pointsBehind]),
      [
        ["Handmade proof", 8.8],
        ["Delivered cost", 2.4],
        ["Completeness", 0],
        ["Lead time", -1],
      ],
    );
    assert.deepEqual(d.lostOn, ["Handmade proof", "Delivered cost"]);
    assert.deepEqual(d.beatOn, ["Lead time"]);
  });

  it("says plainly when the bid was over budget", () => {
    const d = buildDebrief({ ...base, myBidId: "A" })!;
    assert.match(d.summary, /over the tender owner's €3,000 budget, so it ranked after every bid within budget/);
    assert.match(d.summary, /^Your bid ranked 3rd of 3/);
    assert.match(d.summary, /You beat the winning bid on Lead time\./);
  });

  it("shows only the seller's own reasons, never the reasons written about the winner", () => {
    const d = buildDebrief({ ...base, myBidId: "A" })!;
    assert.ok(d.lines.every((l) => l.myReason.endsWith("for A")));
    assert.ok(!JSON.stringify(d).includes("for D"));
  });

  it("says so when the buyer chose a bid that did not rank first", () => {
    const d = buildDebrief({ ...base, myBidId: "D", winnerBidId: "B" })!;
    assert.equal(d.rank, 1);
    assert.equal(d.winnerRank, 2);
    assert.match(d.summary, /The tender owner chose a bid that ranked 2nd: FairBid ranks the bids, the tender owner decides\./);
  });

  it("has nothing to say to the winner or before scores exist", () => {
    assert.equal(buildDebrief({ ...base, myBidId: "D" }), null);
    assert.equal(buildDebrief({ ...base, bids: [{ ...A, total: null }, B, D], myBidId: "A" }), null);
    assert.equal(buildDebrief({ ...base, myBidId: "nobody" }), null);
  });
});
