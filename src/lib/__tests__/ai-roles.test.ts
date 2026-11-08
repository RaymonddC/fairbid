import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyHs, explainPair, HS_FIXTURE, PAIR_FIXTURE, reviewProposals, scoreBlind, writeTender } from "../ai/roles";
import { clampDraft, draftFrom } from "../draft";

// No key: every role must answer from its fixture, with no network call. The key is
// read at call time, so removing it here covers every test below.
delete process.env.ANTHROPIC_API_KEY;

const REVIEW_INPUT = {
  title: "300 napkins",
  needText: "Handmade batik napkins",
  deliveryDays: 28,
  criteria: [{ name: "Handmade proof", weightPct: 25, rubric: "Stated technique" }],
  bids: [
    { letter: "A", notes: "Printed", hsCode: "6302.51", leadTimeDays: 20, photoCount: 1 },
    { letter: "B", notes: "Batik style", hsCode: "6302.51", leadTimeDays: 25, photoCount: 1 },
  ],
};

describe("AI roles without a key", () => {
  it("drafts a tender from the scripted guess, inside the limits", async () => {
    const r = await writeTender("We need 300 napkins, budget 3,000 euros, within 6 weeks.");
    assert.equal(r.source, "fixture");
    assert.equal(r.value.quantity, 300);
    assert.equal(r.value.budget, 3000);
    assert.equal(r.value.deliveryDays, 28, "six weeks is capped inside the 29-day hold");
  });

  it("classifies with the demo code", async () => {
    const r = await classifyHs("cotton napkins");
    assert.equal(r.source, "fixture");
    assert.equal(r.value.hsCode, HS_FIXTURE.hsCode);
  });

  it("explains a pair with the neutral sentence", async () => {
    const r = await explainPair({ letters: ["B", "C"], evidence: ["Quotes differ by 0.4%"], notes: ["x", "x"] });
    assert.equal(r.value, PAIR_FIXTURE);
  });

  it("scores every judged criterion from the fixture", async () => {
    const r = await scoreBlind(
      {
        tender: { title: "t", needText: "n" },
        criteria: [{ name: "Handmade proof", rubric: "r" }],
        bid: { notes: "n", hsCode: null, leadTimeDays: 10, photos: [] },
        clarifications: [],
      },
      () => ({ score: 42, reason: "fixture" }),
    );
    assert.deepEqual(r.value, { "Handmade proof": { score: 42, reason: "fixture" } });
    assert.equal(r.source, "fixture");
  });
});

describe("reviewer guardrails", () => {
  it("drops unknown bid letters, adds the price lock once, and keeps at most three questions", async () => {
    const r = await reviewProposals(REVIEW_INPUT, () => [
      { topic: "Technique", question: "Is it hand-stamped? Your price cannot change.", bids: ["a", "B", "Z"] },
      { topic: "Ghost", question: "Only to a bid that does not exist?", bids: ["Q"] },
      { topic: "Size", question: "What size are they?", bids: ["A"] },
      { topic: "Sample", question: "Can you send a sample first?", bids: ["B"] },
      { topic: "Extra", question: "One more question for bid A?", bids: ["A"] },
    ]);
    assert.equal(r.value.length, 3);
    assert.deepEqual(r.value[0].bids, ["A", "B"]);
    for (const q of r.value) {
      assert.match(q.question, /Your price cannot change\.$/);
      assert.equal(q.question.match(/price cannot change/gi)?.length, 1);
    }
    assert.ok(!r.value.some((q) => q.topic === "Ghost"));
  });
});

describe("draft limits", () => {
  it("clamps whatever the model returns", () => {
    const d = clampDraft({ title: "  ", item: "", quantity: -5, budget: 1e9, deliveryDays: 60, destination: "FR" as "DE", questions: [" a ", "", "b", "c", "d"] });
    assert.deepEqual(d, { title: "New tender", item: "Items", quantity: 1, budget: 1_000_000, deliveryDays: 28, destination: "DE", questions: ["a", "b", "c"] });
  });

  it("reads dollars as a US delivery", () => {
    assert.equal(draftFrom("We need 50 mugs for $800 in 2 weeks").destination, "US");
  });
});
