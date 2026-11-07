import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MILESTONES,
  IllegalTransitionError,
  assertTransition,
  canSubmitBid,
  canTransition,
  isSealed,
  milestoneAmounts,
} from "../tender";

describe("tender state machine", () => {
  it("walks the full happy path", () => {
    const path = ["DRAFT", "OPEN", "CLOSED", "REVIEWING", "CLARIFYING", "PRICED", "SCORED", "AWARDED", "IN_DELIVERY", "COMPLETE"] as const;
    for (let i = 0; i < path.length - 1; i++) assert.ok(canTransition(path[i], path[i + 1]), `${path[i]} to ${path[i + 1]}`);
  });

  it("has no way to cancel after award, because the sandbox refuses void", () => {
    assert.equal(canTransition("AWARDED", "CANCELLED"), false);
    assert.equal(canTransition("IN_DELIVERY", "CANCELLED"), false);
  });

  it("refuses to skip review", () => {
    assert.throws(() => assertTransition("OPEN", "SCORED"), IllegalTransitionError);
  });
});

describe("sealed bids", () => {
  it("keeps bids sealed until the tender closes", () => {
    assert.equal(isSealed("OPEN"), true);
    assert.equal(isSealed("CLOSED"), false);
  });

  it("refuses a bid after the close time", () => {
    const closesAt = new Date("2026-11-10T00:00:00Z");
    assert.equal(canSubmitBid("OPEN", closesAt, new Date("2026-11-09T23:59:59Z")), true);
    assert.equal(canSubmitBid("OPEN", closesAt, closesAt), false);
    assert.equal(canSubmitBid("CLOSED", closesAt, new Date("2026-11-01T00:00:00Z")), false);
  });
});

describe("milestones", () => {
  it("splits the hold 30/40/30", () => {
    assert.deepEqual(milestoneAmounts(288_000, DEFAULT_MILESTONES), [86_400, 115_200, 86_400]);
  });

  it("always sums to the hold, with rounding on the last milestone", () => {
    const amounts = milestoneAmounts(100_001, DEFAULT_MILESTONES);
    assert.equal(amounts.reduce((sum, amount) => sum + amount, 0), 100_001);
  });

  it("refuses percentages that do not sum to 100", () => {
    assert.throws(() => milestoneAmounts(100, [{ name: "Only", pct: 90 }]));
  });
});
