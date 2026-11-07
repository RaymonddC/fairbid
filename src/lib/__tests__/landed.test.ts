import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEMO_BIDS } from "../../../prisma/seed-data";
import { deliveredCents, isOverBudget, landedCost } from "../landed";

const TARIFF = { dutyPct: 12, vatPct: 19, asOf: "2026-07-01" };
const BUDGET = 300_000;
const euros = (cents: number) => Math.round(cents / 100);

const landedFor = (sellerId: string) => {
  const bid = DEMO_BIDS.find((candidate) => candidate.sellerId === sellerId);
  assert.ok(bid);
  return landedCost(bid, TARIFF);
};

describe("landed cost matches the deck's comparison slide", () => {
  const expected = {
    "seller-a": { duty: 270, vat: 559, reclaimed: 3050, gross: 3609 },
    "seller-b": { duty: 288, vat: 568, reclaimed: 3078, gross: 3646 },
    "seller-c": { duty: 289, vat: 570, reclaimed: 3089, gross: 3659 },
    "seller-d": { duty: 275, vat: 535, reclaimed: 2880, gross: 3415 },
  };

  for (const [sellerId, row] of Object.entries(expected)) {
    it(sellerId, () => {
      const landed = landedFor(sellerId);
      assert.equal(euros(landed.dutyCents), row.duty);
      assert.equal(euros(landed.vatCents), row.vat);
      assert.equal(euros(landed.deliveredReclaimedCents), row.reclaimed);
      assert.equal(euros(landed.deliveredGrossCents), row.gross);
    });
  }

  it("exposes the lowest quote as over budget and keeps the winner inside it", () => {
    assert.equal(isOverBudget(landedFor("seller-a"), BUDGET), true);
    assert.equal(isOverBudget(landedFor("seller-d"), BUDGET), false);
  });

  it("saves EUR 170 against bidder A if VAT is reclaimed, EUR 194 if not", () => {
    const a = landedFor("seller-a");
    const d = landedFor("seller-d");
    assert.equal(euros(deliveredCents(a, true) - deliveredCents(d, true)), 170);
    assert.equal(euros(deliveredCents(a, false) - deliveredCents(d, false)), 194);
  });
});

describe("small parcels", () => {
  const parcel = { goodsCents: 10_000, shippingCents: 1_000, feesCents: 0 };

  it("charges the flat EUR 3 per tariff category under EUR 150", () => {
    const landed = landedCost({ ...parcel, tariffCategories: 2 }, TARIFF);
    assert.equal(landed.dutyCents, 600);
    assert.equal(landed.dutyRule, "small_parcel_flat");
  });

  it("uses the percentage rate at exactly EUR 150", () => {
    const landed = landedCost({ ...parcel, goodsCents: 15_000 }, TARIFF);
    assert.equal(landed.dutyCents, 1_800);
    assert.equal(landed.dutyRule, "percent");
  });

  it("does not apply the flat rate to the 300-napkin order", () => {
    assert.equal(landedFor("seller-d").dutyRule, "percent");
  });
});
