import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { deliverToBuyer, newBidText, ordinal, pickLinkCode, replyText, routeInbound, sellerQuestionText, type RouteInput } from "../channels/buyer";
import { telegramChannel } from "../channels/telegram";

const base: RouteInput = { linkCode: false, bareStart: false, sellerLinked: false, buyerLinked: false, repliesToBuyer: null };

test("route: a link code always links, whoever holds the chat", () => {
  assert.equal(routeInbound({ ...base, linkCode: true }), "link");
  assert.equal(routeInbound({ ...base, linkCode: true, sellerLinked: true, buyerLinked: true }), "link");
});

test("route: a seller-only chat routes as before buyers could link", () => {
  assert.equal(routeInbound({ ...base, sellerLinked: true }), "seller");
  assert.equal(routeInbound({ ...base, sellerLinked: true, bareStart: true }), "how-to-link");
  assert.equal(routeInbound(base), "how-to-link");
  assert.equal(routeInbound({ ...base, bareStart: true }), "how-to-link");
});

test("route: a reply to a seller question sent to the buyer is the buyer's answer", () => {
  assert.equal(routeInbound({ ...base, buyerLinked: true, repliesToBuyer: { tenderQuestionId: "q1" } }), "buyer-answer");
  // The same chat linked on both sides: the reply goes to the side whose message it answers.
  assert.equal(routeInbound({ ...base, buyerLinked: true, sellerLinked: true, repliesToBuyer: { tenderQuestionId: "q1" } }), "buyer-answer");
  assert.equal(routeInbound({ ...base, buyerLinked: true, sellerLinked: true, repliesToBuyer: null }), "seller");
});

test("route: other buyer messages get help", () => {
  assert.equal(routeInbound({ ...base, buyerLinked: true }), "buyer-help");
  assert.equal(routeInbound({ ...base, buyerLinked: true, bareStart: true }), "buyer-help");
  assert.equal(routeInbound({ ...base, buyerLinked: true, repliesToBuyer: { tenderQuestionId: null } }), "buyer-help");
  // A buyer match without a buyer link cannot happen, but must not answer anything.
  assert.equal(routeInbound({ ...base, repliesToBuyer: { tenderQuestionId: "q1" } }), "how-to-link");
});

test("link code: found in either table, only for its channel and before it expires", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  const good = { kind: "telegram", expiresAt: new Date("2026-11-12T12:10:00Z") };
  const old = { kind: "telegram", expiresAt: new Date("2026-11-12T11:59:00Z") };
  assert.equal(pickLinkCode(good, null, "telegram", now), "seller");
  assert.equal(pickLinkCode(null, good, "telegram", now), "buyer");
  assert.equal(pickLinkCode(old, good, "telegram", now), "buyer");
  assert.equal(pickLinkCode(null, old, "telegram", now), null);
  assert.equal(pickLinkCode(null, good, "whatsapp", now), null);
  assert.equal(pickLinkCode(null, null, "telegram", now), null);
});

test("texts: a new bid says the count only", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
  const t = newBidText("Batik scarves", 3);
  assert.match(t, /A 3rd sealed bid arrived on "Batik scarves"\. Prices stay sealed until you close bidding\./);
  assert.doesNotMatch(t, /€|\d{2,}/);
  assert.match(newBidText("X", 1), /The first sealed bid/);
});

test("texts: a reply names the bid letter, a seller question invites a reply", () => {
  assert.match(replyText("Batik scarves", "C", " Yes, hand-drawn. "), /Bid C answered your question on "Batik scarves":\n\nYes, hand-drawn\.$/);
  const q = sellerQuestionText("Batik scarves", "Is cotton fine?");
  assert.match(q, /A seller asked about "Batik scarves"/);
  assert.match(q, /Reply to this message to answer every seller/);
});

test("deliver: records the sent id, and a failure never throws", async () => {
  const recorded: string[] = [];
  const warned: string[] = [];
  const ok = await deliverToBuyer("555", "hi", false, {
    send: async () => ({ externalId: "77" }),
    record: async (id) => void recorded.push(id),
    warn: (m) => void warned.push(m),
  });
  assert.equal(ok, true);
  assert.deepEqual(recorded, ["77"]);
  const failed = await deliverToBuyer("555", "hi", false, {
    send: async () => {
      throw new Error("down");
    },
    record: async (id) => void recorded.push(id),
    warn: (m) => void warned.push(m),
  });
  assert.equal(failed, false);
  assert.deepEqual(recorded, ["77"]);
  assert.equal(warned.length, 1);
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("telegram send: an update needs no reply box, a question opens one", async () => {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), { status: 200 });
  }) as typeof fetch;
  assert.deepEqual(await telegramChannel.send("555", "A 2nd sealed bid", { expectReply: false }), { externalId: "9" });
  assert.deepEqual(await telegramChannel.send("555", "A seller asked"), { externalId: "9" });
  assert.equal(bodies[0].reply_markup, undefined);
  assert.deepEqual(bodies[1].reply_markup, { force_reply: true, input_field_placeholder: "Your answer" });
});

test("telegram send: a refusal throws without the token in the message", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "123:secret-token";
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, description: "chat not found" }), { status: 400 })) as typeof fetch;
  await assert.rejects(telegramChannel.send("555", "x", { expectReply: false }), (e: Error) => !e.message.includes("secret-token") && /chat not found/.test(e.message));
  delete process.env.TELEGRAM_BOT_TOKEN;
});
