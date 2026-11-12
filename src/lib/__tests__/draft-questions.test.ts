import assert from "node:assert/strict";
import { test } from "node:test";
import { draftFrom, gapQuestions } from "../draft";

test("asks about size, colour and packing when the request leaves them open", () => {
  assert.deepEqual(gapQuestions("I need 300 handmade batik napkins for our hotels. Budget 3,000 euros, within 4 weeks."), [
    "What size should each one be?",
    "Any colours or pattern you want?",
    "How should they be packed or labelled?",
  ]);
});

test("does not ask what the request already says", () => {
  assert.deepEqual(gapQuestions("200 runners, 180 x 40 cm, indigo and brown, ten per bag in a carton"), []);
  assert.deepEqual(gapQuestions("120 mugs, 300 ml, glazed in earthy colours"), ["How should they be packed or labelled?"]);
});

test("the scripted draft carries the questions, so the AI-off flow still asks", () => {
  assert.ok(draftFrom("I need 50 rattan baskets for our shop, budget 900 euros, within 3 weeks.").questions.length > 0);
});
