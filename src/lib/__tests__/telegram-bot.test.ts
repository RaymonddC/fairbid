import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewFixture } from "../ai/roles";
import { bidStatus, commandsFor, helpText, openTenderCard, ownerStatus, ownerTenderCard, parseCommand, parseTap, tapData } from "../channels/bot-text";
import { inlineKeyboard, parseTelegramUpdate } from "../channels/telegram";

const ID = "00000000-0000-4000-8000-0000000000b1";

test("commands: bare commands only, with or without the bot's name", () => {
  assert.equal(parseCommand("/tenders"), "tenders");
  assert.equal(parseCommand(" /OPEN "), "open");
  assert.equal(parseCommand("/bids@fairbid_official_bot"), "bids");
  assert.equal(parseCommand("/start ABCD2345"), null);
  assert.equal(parseCommand("/delete"), null);
  assert.equal(parseCommand("how are my tenders?"), null);
});

test("taps: our own button data reads back, anything else is ignored", () => {
  assert.deepEqual(parseTap(tapData.owner("c", ID)), { side: "owner", verb: "close", tenderId: ID });
  assert.deepEqual(parseTap(tapData.owner("C", ID)), { side: "owner", verb: "confirm-close", tenderId: ID });
  assert.deepEqual(parseTap(tapData.bidder("a", ID)), { side: "bidder", verb: "ask", tenderId: ID });
  assert.deepEqual(parseTap(tapData.agent("on")), { side: "bidder", verb: "agent-on" });
  assert.deepEqual(parseTap(tapData.dismiss), { side: "none", verb: "dismiss" });
  assert.equal(parseTap("o:c:not-an-id"), null);
  assert.equal(parseTap("o:pay:" + ID), null);
  assert.equal(parseTap("b:on:" + ID), null);
  for (const d of [tapData.owner("C", ID), tapData.bidder("r", ID)]) assert.ok(Buffer.byteLength(d) <= 64);
});

test("telegram update: a button tap carries its data and the chat", () => {
  const m = parseTelegramUpdate({ update_id: 7, callback_query: { id: "cb1", data: "x", message: { message_id: 3, chat: { id: 42, type: "private" } } } });
  assert.deepEqual(m, { kind: "telegram", address: "42", text: "x", externalId: "update:7", private: true, tap: { id: "cb1", data: "x" } });
  assert.equal(parseTelegramUpdate({ update_id: 8, callback_query: { id: "cb2", message: { chat: { id: 42 } } } }), null);
});

test("keyboard: link buttons need https, empty rows go", () => {
  assert.deepEqual(
    inlineKeyboard([
      [{ text: "Close", data: "o:c:1" }],
      [{ text: "Open", url: "http://localhost:3000/x" }],
    ]),
    { inline_keyboard: [[{ text: "Close", callback_data: "o:c:1" }]] },
  );
  assert.equal(inlineKeyboard([[{ text: "Open", url: "http://localhost" }]]), undefined);
});

test("cards: an owner sees the count of bids only, and Close only while open", () => {
  const open = ownerTenderCard({ id: ID, title: "Cushions", status: "OPEN", bids: 3, closes: "14 Nov, 18:00", waiting: 1, answered: 2 }, "https://x/tender/1");
  assert.match(open.text, /Open, 3 sealed bids, closes 14 Nov/);
  assert.match(open.text, /1 question waiting/);
  assert.ok(open.buttons.flat().some((b) => b.text === "Close bidding"));
  const closed = ownerTenderCard({ id: ID, title: "Cushions", status: "SCORED", bids: 3, closes: "", waiting: 0, answered: 0 }, null);
  assert.ok(!closed.buttons.flat().some((b) => b.text === "Close bidding"));
  assert.equal(ownerStatus("CLARIFYING", 1), "Bidding closed, 1 bid: questions to bidders");
});

test("cards: a bidder who already bid is not offered another agent bid", () => {
  const base = { id: ID, title: "Runners", quantity: 120, item: "table runners", destination: "Germany", budget: "€2,000", closes: "20 Nov", answers: 0 };
  assert.ok(openTenderCard({ ...base, youBid: false }, null).buttons.flat().some((b) => b.text === "Let my agent bid"));
  assert.ok(!openTenderCard({ ...base, youBid: true }, null).buttons.flat().some((b) => b.text === "Let my agent bid"));
  assert.equal(bidStatus("AWARDED", false), "Another bid was chosen");
  assert.equal(bidStatus("OPEN", null), "Sealed until bidding closes");
});

test("help and commands follow the sides the chat is linked to", () => {
  assert.deepEqual(commandsFor({ owner: true, bidder: false }).map((c) => c.command), ["tenders", "waiting", "help"]);
  assert.deepEqual(commandsFor({ owner: false, bidder: true }).map((c) => c.command), ["open", "bids", "agent", "help"]);
  assert.doesNotMatch(helpText({ owner: true, bidder: false }), /\/open/);
});

test("review fixture: with the AI off, every bid is asked about each judged criterion", () => {
  const qs = reviewFixture(
    {
      title: "Cushions",
      needText: "",
      deliveryDays: 28,
      criteria: [
        { name: "Delivered cost", weightPct: 50, rubric: "" },
        { name: "Handmade proof", weightPct: 30, rubric: "Hand-stamped wax batik." },
      ],
      bids: [
        { letter: "A", notes: "", hsCode: null, leadTimeDays: 20, photoCount: 1 },
        { letter: "B", notes: "", hsCode: null, leadTimeDays: 20, photoCount: 1 },
      ],
    },
    (name) => name === "Handmade proof",
  );
  assert.equal(qs.length, 1);
  assert.deepEqual(qs[0].bids, ["A", "B"]);
  assert.match(qs[0].question, /Handmade proof/);
});
