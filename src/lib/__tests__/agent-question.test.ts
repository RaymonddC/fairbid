import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseMaterials, parseSizes, questionFromBrief } from "../agents/brief";
import {
  bidderAgentTurn,
  bidderSummaryFixture,
  MAX_TURNS,
  ownerSummaryFixture,
  summarizeForBidder,
  summarizeForOwner,
  tidyAgentQuestion,
} from "../ai/roles";

// No project: every role answers from its fixture, with no network call.
delete process.env.GOOGLE_CLOUD_PROJECT;

const SARI =
  "Hand-stamped cotton batik napkins, 40 x 40 cm, about €7.50 each. Ships from Yogyakarta in about 3 weeks, shipping around €250 to Europe.";

const NAPKINS = {
  title: "300 handmade batik napkins, Berlin",
  needText: "I need 300 handmade batik napkins for our four hotels in Germany. Budget is around 3,000 euros before VAT, within 4 weeks.",
  item: "Handmade batik napkins",
  quantity: 300,
  deliveryDays: 28,
};

const RUNNERS = {
  title: "200 hand-drawn batik table runners, Hamburg",
  needText: "We need 200 hand-drawn batik table runners for our hotel restaurants, about 180 x 40 cm, indigo and brown.",
  item: "Hand-drawn batik table runners",
  quantity: 200,
  deliveryDays: 35,
};

const RUNNER_BRIEF =
  "Hand-stamped cotton batik table runners and scarves, 180 x 40 cm, about €14 each. Ships from Yogyakarta in about 3 weeks, shipping around €300 to Europe.";

describe("parseSizes", () => {
  it("reads sizes with two or three numbers, or one", () => {
    assert.deepEqual(parseSizes("napkins, 40 x 40 cm"), [{ cm: [40, 40], text: "40 x 40 cm" }]);
    assert.deepEqual(parseSizes("180×40cm"), [{ cm: [180, 40], text: "180 x 40 cm" }]);
    assert.deepEqual(parseSizes("a lampshade, 40 cm"), [{ cm: [40], text: "40 cm" }]);
    assert.deepEqual(parseSizes("400 x 400 mm")[0].cm, [40, 40]);
  });
  it("does not take volumes, weights, money or days for a size", () => {
    assert.deepEqual(parseSizes("mugs, 300 ml, €12 each, 200 in 3 weeks, 5 kg"), []);
  });
});

describe("parseMaterials", () => {
  it("finds the materials a text names", () => {
    assert.deepEqual(parseMaterials("Hand-carved teak boards"), ["teak"]);
    assert.deepEqual(parseMaterials("cotton or silk scarves"), ["cotton", "silk"]);
    assert.deepEqual(parseMaterials("batik napkins"), []);
  });
});

describe("questionFromBrief", () => {
  it("asks about the size when the tender states none", () => {
    assert.equal(questionFromBrief(SARI, NAPKINS), "Is 40 x 40 cm the size you want?");
  });
  it("asks when the tender states a different size", () => {
    assert.equal(questionFromBrief(SARI, { ...NAPKINS, needText: "Napkins, 45 x 45 cm." }), "Would 40 x 40 cm work instead of 45 x 45 cm?");
  });
  it("asks about the material when the size fits and the tender names no material", () => {
    assert.equal(questionFromBrief(RUNNER_BRIEF, RUNNERS), "Is cotton acceptable?");
  });
  it("asks when the tender names another material", () => {
    assert.equal(questionFromBrief(SARI, { ...NAPKINS, needText: "Linen napkins, 40 x 40 cm." }), "Is cotton acceptable instead of linen?");
  });
  it("asks nothing when the tender settles size and material", () => {
    assert.equal(questionFromBrief(SARI, { ...NAPKINS, needText: "Cotton batik napkins, 40 x 40 cm." }), null);
    assert.equal(questionFromBrief("Batik napkins, about €7.50 each.", NAPKINS), null);
  });
  it("reads published answers as part of the tender", () => {
    assert.equal(questionFromBrief(SARI, NAPKINS, ["What size?", "40 x 40 cm, cotton is fine."]), null);
  });
  it("asks nothing on a tender the bidder does not make for", () => {
    assert.equal(questionFromBrief(SARI, { ...NAPKINS, title: "60 rattan baskets", item: "Rattan baskets" }), null);
    assert.equal(questionFromBrief("", NAPKINS), null);
  });
  it("uses the size of the product the tender buys when the brief lists several", () => {
    const many =
      "Hand-stamped cotton batik: napkins 40 x 40 cm about €7.60 each, table runners 180 x 40 cm about €14 each, scarves about €9 each.";
    assert.equal(questionFromBrief(many, { ...RUNNERS, needText: "Batik table runners, 200 x 40 cm." }), "Would 180 x 40 cm work instead of 200 x 40 cm?");
    assert.equal(questionFromBrief(many, NAPKINS), "Is 40 x 40 cm the size you want?");
    // No size for scarves in the brief: never another product's size. The tender names cotton, so nothing to ask.
    assert.equal(questionFromBrief(many, { ...RUNNERS, title: "500 scarves", item: "Batik scarves", needText: "Cotton scarves, 180 x 50 cm." }), null);
  });
  it("never mentions a price", () => {
    for (const q of [questionFromBrief(SARI, NAPKINS), questionFromBrief(RUNNER_BRIEF, RUNNERS)]) assert.doesNotMatch(q ?? "", /€|\d+\.\d\d|price/i);
  });
});

describe("tidyAgentQuestion", () => {
  it("keeps one short neutral question", () => {
    assert.equal(tidyAgentQuestion("  Is 40 x 40 cm   the size you want? "), "Is 40 x 40 cm the size you want?");
  });
  it("drops empty, too short, and money or competitor questions", () => {
    assert.equal(tidyAgentQuestion(""), null);
    assert.equal(tidyAgentQuestion(undefined), null);
    assert.equal(tidyAgentQuestion("Size?"), null);
    assert.equal(tidyAgentQuestion("What price did the other bidders offer?"), null);
    assert.equal(tidyAgentQuestion("Is the budget flexible for this order?"), null);
    assert.equal(tidyAgentQuestion("What would it take to win this tender?"), null);
  });
});

describe("bidderAgentTurn with the AI off", () => {
  it("asks the gap question as the first turn, and nothing more after it", async () => {
    const first = await bidderAgentTurn(SARI, NAPKINS, [], []);
    assert.deepEqual(first, { value: "Is 40 x 40 cm the size you want?", source: "fixture" });
    const second = await bidderAgentTurn(SARI, NAPKINS, [], [{ question: first.value!, answer: "Yes.", answeredBy: "ai" }]);
    assert.equal(second.value, null);
  });
  it("asks nothing when the tender settles it, and never past the last turn", async () => {
    assert.equal((await bidderAgentTurn(SARI, { ...NAPKINS, needText: "Cotton napkins, 40 x 40 cm." }, [], [])).value, null);
    const full = Array.from({ length: MAX_TURNS }, (_, i) => ({ question: `Question number ${i}?`, answer: null }));
    assert.equal((await bidderAgentTurn(SARI, NAPKINS, [], full)).value, null);
  });
});

describe("summaries with the AI off", () => {
  const turns = [
    { question: "Is 180 x 40 cm the size you want?", answer: "Yes, the tender asks for about 180 x 40 cm.", answeredBy: "ai" as const },
    { question: "How should the runners be packed?", answer: null },
  ];
  it("tells the bidder what was asked, what came back and what it did, without a price", async () => {
    const s = bidderSummaryFixture(turns, { bid: true });
    assert.match(s, /180 x 40 cm/);
    assert.match(s, /tender owner's AI answered/);
    assert.match(s, /waits for the tender owner/);
    assert.match(s, /sealed a bid from your prices/);
    assert.doesNotMatch(s, /€|\$/);
    assert.equal((await summarizeForBidder("200 runners", turns, { bid: true })).value, s);
    assert.match(bidderSummaryFixture([], { bid: false, reason: "Not something you make." }), /Then did not bid: Not something you make\.$/);
  });
  it("tells the tender owner what bidders asked, without who, and the count of sealed bids", async () => {
    const s = ownerSummaryFixture(turns, 2);
    assert.match(s, /Bidders asked 2 things/);
    assert.match(s, /answered by your AI from the tender/);
    assert.match(s, /1 waits for you/);
    assert.match(s, /2 sealed bids so far/);
    assert.equal((await summarizeForOwner("200 runners", turns, 2)).value, s);
    assert.match(ownerSummaryFixture([], 0), /No bidder has asked anything yet/);
  });
});
