import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEMO_BIDS } from "../../../prisma/seed-data";
import { holdCents, landedCost } from "../landed";
import {
  completenessScore,
  costScore,
  criterionKind,
  formatEur,
  findCoordinatedPairs,
  leadTimeScore,
  weightedTotal,
} from "../scoring";

describe("criterion kinds", () => {
  it("reads cost before delivery, since 'Delivered cost' contains both", () => {
    assert.equal(criterionKind("Delivered cost"), "cost");
    assert.equal(criterionKind("Lead time"), "lead_time");
    assert.equal(criterionKind("Completeness"), "completeness");
    assert.equal(criterionKind("Handmade proof"), "reviewed");
  });
});

describe("scores", () => {
  it("gives the lowest delivered cost 100", () => {
    assert.equal(costScore(288_000, 288_000).score, 100);
    assert.equal(costScore(305_000, 288_000).score, 94);
  });

  it("scores earlier delivery higher and late delivery 0", () => {
    assert.ok(leadTimeScore(21, 28).score > leadTimeScore(24, 28).score);
    assert.equal(leadTimeScore(30, 28).score, 0);
  });

  it("marks what is missing", () => {
    assert.equal(completenessScore({ hsCode: "6302.51", notes: "x", photoCount: 1 }).score, 100);
    assert.match(completenessScore({ hsCode: null, notes: "x", photoCount: 0 }).reason, /customs code, photos/);
  });

  it("weights add up", () => {
    assert.equal(weightedTotal([{ score: 100, weightPct: 40 }, { score: 50, weightPct: 60 }]), 70);
  });
});

describe("collusion pairs on the demo tender", () => {
  const at = new Date("2026-11-08T14:40:00Z");
  const bids = DEMO_BIDS.map((b, i) => ({ id: b.sellerId, ...b, submittedAt: new Date(at.getTime() + i * 12 * 60_000) }));

  it("flags B and C only", () => {
    const pairs = findCoordinatedPairs(bids);
    assert.deepEqual(
      pairs.map((p) => [p.bidId, p.pairedBidId]),
      [["seller-b", "seller-c"]],
    );
    assert.ok(pairs[0].evidence.length >= 3);
  });
});

describe("hold", () => {
  it("holds goods and shipping for the seller, not the border costs", () => {
    const d = DEMO_BIDS.find((b) => b.sellerId === "seller-d")!;
    assert.equal(holdCents(landedCost(d, { dutyPct: 12, vatPct: 19, asOf: "2026-07-01" })), 254_000);
  });
});

describe("money in the tender's own currency", () => {
  it("formats euros and dollars, never mixing them", () => {
    assert.equal(formatEur(17_000), "€170");
    assert.equal(formatEur(17_000, "USD"), "$170");
    assert.match(costScore(305_000, 288_000, "USD").reason, /^\$170 above/);
  });

  it("writes the coordination evidence in the tender's currency", () => {
    const at = new Date("2026-11-08T14:40:00Z");
    const pairs = findCoordinatedPairs(
      [
        { id: "b", goodsCents: 240_000, shippingCents: 30_000, feesCents: 9_000, notes: "x", submittedAt: at },
        { id: "c", goodsCents: 241_000, shippingCents: 30_000, feesCents: 9_000, notes: "x", submittedAt: at },
      ],
      "USD",
    );
    assert.ok(pairs[0].evidence.some((e) => e.includes("$300")));
  });
});
