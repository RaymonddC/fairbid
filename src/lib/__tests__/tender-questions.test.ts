import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerAsBuyer, answerFromTender, type PublishedTender } from "../ai/roles";
import { QUESTION_MAX, QUESTIONS_PER_SELLER, canAskMore, checkAnswer, checkQuestion, publish } from "../tender-questions";

delete process.env.GOOGLE_CLOUD_PROJECT;

const TENDER: PublishedTender = {
  title: "300 handmade batik napkins, Berlin",
  needText: "300 handmade batik napkins for a restaurant in Berlin.",
  spec: { item: "batik napkins", quantity: 300, deliverTo: "Berlin", deliveryDays: 28 },
  criteria: [
    { name: "Cost", weightPct: 50, rubric: "Delivered cost" },
    { name: "Handmade proof", weightPct: 25, rubric: "Stated technique" },
    { name: "Lead time", weightPct: 25, rubric: "Days" },
  ],
  budgetCents: 300_000,
  currency: "EUR",
  destinationCountry: "DE",
  closesAt: "2026-11-20T12:00:00.000Z",
  referencePhotoCount: 2,
};

describe("the buyer's scripted answerer", () => {
  it("answers the quantity from the spec", () => {
    const r = answerFromTender("How many pieces do you need?", TENDER);
    assert.equal(r.answerable, true);
    assert.match(r.answer, /300 × batik napkins/);
  });

  it("answers the delivery window, not the quantity, for 'how many days'", () => {
    const r = answerFromTender("How many days do we have to deliver?", TENDER);
    assert.match(r.answer, /within 28 days/);
  });

  it("answers where it goes", () => {
    assert.match(answerFromTender("Where should the goods be delivered?", TENDER).answer, /Delivery is to Berlin, DE\./);
  });

  it("answers the published budget and the criteria with their weights", () => {
    assert.match(answerFromTender("What is the budget?", TENDER).answer, /3,000 EUR/);
    assert.match(answerFromTender("How are bids scored?", TENDER).answer, /Handmade proof 25%/);
  });

  it("never answers about other bids or sellers", () => {
    assert.equal(answerFromTender("How many bids have other sellers sent, and when is the deadline?", TENDER).answerable, false);
    assert.equal(answerFromTender("What is the lowest bid so far?", TENDER).answerable, false);
  });

  it("leaves a question the tender does not settle for the buyer", () => {
    const r = answerFromTender("Is a machine-sewn hem acceptable?", TENDER);
    assert.deepEqual(r, { answerable: false, answer: "" });
  });

  it("falls back to the script without an AI project", async () => {
    const r = await answerAsBuyer("How many pieces?", TENDER);
    assert.equal(r.source, "fixture");
    assert.equal(r.value.answerable, true);
  });
});

describe("question rules", () => {
  it("wants a full sentence under the cap", () => {
    assert.equal(checkQuestion("Size?").ok, false);
    assert.equal(checkQuestion("x".repeat(QUESTION_MAX + 1)).ok, false);
    assert.equal(checkQuestion(42).ok, false);
    const ok = checkQuestion("  What   size is each napkin?  ");
    assert.deepEqual(ok, { ok: true, text: "What size is each napkin?" });
  });

  it("checks an answer", () => {
    assert.equal(checkAnswer(" ").ok, false);
    assert.equal(checkAnswer("Yes, 45 cm square.").ok, true);
  });

  it("caps questions per seller", () => {
    assert.equal(canAskMore(QUESTIONS_PER_SELLER - 1), true);
    assert.equal(canAskMore(QUESTIONS_PER_SELLER), false);
  });

  it("publishes without the seller, marking only the viewer's own", () => {
    const row = {
      id: "q1",
      sellerId: "seller-sari",
      question: "What size?",
      answer: "45 cm",
      answeredBy: "ai",
      askedAt: new Date("2026-11-12T10:00:00Z"),
      answeredAt: new Date("2026-11-12T10:00:01Z"),
    };
    const forBuyer = publish(row);
    assert.equal(JSON.stringify(forBuyer).includes("seller-sari"), false);
    assert.equal("mine" in forBuyer, false);
    assert.equal(publish(row, "seller-sari").mine, true);
    assert.equal(publish(row, "seller-other").mine, false);
    assert.equal(publish({ ...row, answer: null, answeredBy: null }).answeredBy, null);
  });
});
