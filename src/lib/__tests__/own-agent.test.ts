import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerFromBrief, matchesBrief, parseBrief, parseLeadDays, planFromBrief, toCents } from "../agents/brief";

const SARI =
  "Hand-stamped cotton batik napkins, 40 x 40 cm, about €7.50 each. Ships from Yogyakarta in about 3 weeks, shipping around €250 to Europe.";

const NAPKINS = {
  title: "300 handmade batik napkins, Berlin",
  needText: "Handmade batik napkins for our café, 40 x 40 cm.",
  item: "Handmade batik napkins",
  quantity: 300,
  deliveryDays: 28,
};

describe("toCents", () => {
  it("reads decimals with a dot or a comma, and thousands separators", () => {
    assert.equal(toCents("7.50"), 750);
    assert.equal(toCents("7,50"), 750);
    assert.equal(toCents("7.5"), 750);
    assert.equal(toCents("250"), 25_000);
    assert.equal(toCents("1,250"), 125_000);
    assert.equal(toCents("1.250,00"), 125_000);
  });
});

describe("parseBrief", () => {
  it("finds the unit price, shipping and lead time in a seller's own words", () => {
    assert.deepEqual(parseBrief(SARI), { unitCents: 750, shippingCents: 25_000, feesCents: null, leadDays: 21 });
  });
  it("finds fees and other ways of writing a price", () => {
    const f = parseBrief("Rattan baskets, 12 EUR per piece. Freight €180, broker fees €35. Ready in 10 days.");
    assert.deepEqual(f, { unitCents: 1200, shippingCents: 18_000, feesCents: 3500, leadDays: 10 });
  });
  it("leaves out what the brief does not say", () => {
    assert.deepEqual(parseBrief("We weave baskets."), { unitCents: null, shippingCents: null, feesCents: null, leadDays: null });
  });
  it("reads lead times in words", () => {
    assert.equal(parseLeadDays("two weeks"), 14);
    assert.equal(parseLeadDays("1 month"), 30);
    assert.equal(parseLeadDays("we make 100 a day"), null);
  });
});

describe("matchesBrief", () => {
  it("matches a tender for what the seller makes", () => {
    assert.equal(matchesBrief(SARI, NAPKINS).match, true);
  });
  it("does not match something else that is also handmade", () => {
    assert.equal(matchesBrief(SARI, { item: "Handmade rattan baskets", title: "60 rattan baskets" }).match, false);
  });
});

describe("planFromBrief", () => {
  it("bids the unit price times the quantity, with the brief's shipping and lead time", () => {
    assert.deepEqual(planFromBrief(SARI, NAPKINS), {
      kind: "bid",
      goodsCents: 225_000,
      shippingCents: 25_000,
      feesCents: 0,
      leadTimeDays: 21,
      notes: "Hand-stamped cotton batik napkins, 40 x 40 cm, about €7.50 each.",
    });
  });
  it("skips what the seller does not make", () => {
    const p = planFromBrief(SARI, { ...NAPKINS, title: "60 rattan baskets", item: "Rattan baskets", quantity: 60 });
    assert.equal(p.kind, "skip");
  });
  it("skips when the seller cannot deliver in the buyer's window", () => {
    const p = planFromBrief(SARI, { ...NAPKINS, deliveryDays: 14 });
    assert.equal(p.kind, "skip");
    assert.match(p.kind === "skip" ? p.reason : "", /within 14/);
  });
  it("skips without a price, and defaults shipping to a tenth of the goods when none is given", () => {
    assert.equal(planFromBrief("Batik napkins from Yogyakarta.", NAPKINS).kind, "skip");
    const p = planFromBrief("Batik napkins, €5 each.", NAPKINS);
    assert.equal(p.kind, "bid");
    if (p.kind === "bid") {
      assert.equal(p.goodsCents, 150_000);
      assert.equal(p.shippingCents, 15_000);
      assert.equal(p.leadTimeDays, 21);
      assert.ok(Number.isInteger(p.shippingCents));
    }
  });
});

describe("answerFromBrief", () => {
  it("answers from the sentence of the brief that covers the question", () => {
    assert.equal(answerFromBrief(SARI, "Are the napkins hand-stamped batik?"), "Hand-stamped cotton batik napkins, 40 x 40 cm, about €7.50 each.");
  });
  it("leaves questions the brief does not cover, and any question about price, for the seller", () => {
    assert.equal(answerFromBrief(SARI, "Do you hold an OEKO-TEX certificate?"), null);
    assert.equal(answerFromBrief(SARI, "Could you lower the price on the batik napkins?"), null);
  });
});
