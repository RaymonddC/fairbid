import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { formatQuestion, maskAddress, parseLinkCommand } from "../channels/types";
import { parseTelegramUpdate, telegramLink, verifyTelegramSecret } from "../channels/telegram";
import { normalizeWhatsApp, parseAllowlist, parseWhatsAppForm, twilioSignature, twiml, verifyTwilioSignature } from "../channels/whatsapp";

test("telegram secret: exact match only, and closed when unset", () => {
  assert.equal(verifyTelegramSecret("s3cret", "s3cret"), true);
  assert.equal(verifyTelegramSecret("s3cre", "s3cret"), false);
  assert.equal(verifyTelegramSecret("other!", "s3cret"), false);
  assert.equal(verifyTelegramSecret(null, "s3cret"), false);
  assert.equal(verifyTelegramSecret("", ""), false);
  assert.equal(verifyTelegramSecret("x", undefined), false);
});

test("telegram update: text message, reply and private chat", () => {
  const m = parseTelegramUpdate({
    update_id: 9,
    message: { message_id: 42, text: "Yes, 3 weeks", chat: { id: 555, type: "private" }, reply_to_message: { message_id: 40 } },
  });
  assert.deepEqual(m, { kind: "telegram", address: "555", text: "Yes, 3 weeks", externalId: "update:9", replyToExternalId: "40", private: true });
});

test("telegram update: groups are not private, non-text and junk are ignored", () => {
  assert.equal(parseTelegramUpdate({ update_id: 1, message: { message_id: 1, text: "hi", chat: { id: -100, type: "supergroup" } } })?.private, false);
  assert.equal(parseTelegramUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 1, type: "private" } } }), null);
  assert.equal(parseTelegramUpdate({ update_id: 1, edited_message: {} }), null);
  assert.equal(parseTelegramUpdate(null), null);
  assert.equal(parseTelegramUpdate("x"), null);
});

test("telegram deep link", () => {
  assert.equal(telegramLink("ABC12345", "@FairBidBot"), "https://t.me/FairBidBot?start=ABC12345");
});

test("link command: telegram deep link and whatsapp text", () => {
  assert.equal(parseLinkCommand("/start abc23456"), "ABC23456");
  assert.equal(parseLinkCommand("/start@FairBidBot ABC23456"), "ABC23456");
  assert.equal(parseLinkCommand("Link ABC23456 "), "ABC23456");
  assert.equal(parseLinkCommand("/start"), null);
  assert.equal(parseLinkCommand("we can do link ABC23456 soon"), null);
  assert.equal(parseLinkCommand("link AB"), null);
});

test("twilio signature matches Twilio's documented algorithm", () => {
  const params = new URLSearchParams({ To: "whatsapp:+14155238886", From: "whatsapp:+6281", Body: "hi", MessageSid: "SM1" });
  const url = "https://example.test/api/webhooks/whatsapp";
  const expected = createHmac("sha1", "token").update(url + "BodyhiFromwhatsapp:+6281MessageSidSM1Towhatsapp:+14155238886").digest("base64");
  assert.equal(twilioSignature("token", url, params), expected);
  assert.equal(verifyTwilioSignature(expected, "token", url, params), true);
});

test("twilio signature: wrong token, url, tampered body, or missing pieces fail", () => {
  const params = new URLSearchParams({ Body: "hi", From: "whatsapp:+6281" });
  const url = "https://example.test/api/webhooks/whatsapp";
  const sig = twilioSignature("token", url, params);
  assert.equal(verifyTwilioSignature(sig, "other", url, params), false);
  assert.equal(verifyTwilioSignature(sig, "token", "http://example.test/api/webhooks/whatsapp", params), false);
  assert.equal(verifyTwilioSignature(sig, "token", url, new URLSearchParams({ Body: "HI", From: "whatsapp:+6281" })), false);
  assert.equal(verifyTwilioSignature(null, "token", url, params), false);
  assert.equal(verifyTwilioSignature(sig, undefined, url, params), false);
  assert.equal(verifyTwilioSignature(sig, "token", undefined, params), false);
});

test("whatsapp numbers and allowlist", () => {
  assert.equal(normalizeWhatsApp("whatsapp:+62 812-3456-7890"), "+6281234567890");
  assert.equal(normalizeWhatsApp("hello"), null);
  assert.equal(normalizeWhatsApp("123"), null);
  const list = parseAllowlist("+62 812 3456 7890, whatsapp:+4915112345678,bad");
  assert.deepEqual([...list].sort(), ["+4915112345678", "+6281234567890"]);
  assert.equal(parseAllowlist(undefined).size, 0);
});

test("whatsapp inbound form, with reply context", () => {
  const m = parseWhatsAppForm(
    new URLSearchParams({ From: "whatsapp:+6281234567890", Body: "Yes", MessageSid: "SM9", OriginalRepliedMessageSid: "SM5" }),
  );
  assert.deepEqual(m, { kind: "whatsapp", address: "+6281234567890", text: "Yes", externalId: "SM9", replyToExternalId: "SM5", private: true });
  assert.equal(parseWhatsAppForm(new URLSearchParams({ From: "whatsapp:+6281234567890", Body: "Yes" })), null);
  assert.equal(parseWhatsAppForm({}), null);
});

test("twiml escapes markup", () => {
  assert.match(twiml("a <b> & c"), /<Message>a &lt;b&gt; &amp; c<\/Message>/);
});

test("question text and masking", () => {
  const t = formatQuestion("Napkins", "Can you ship in 3 weeks?");
  assert.match(t, /Napkins/);
  assert.match(t, /Can you ship in 3 weeks\?/);
  assert.match(formatQuestion("x".repeat(300), "q"), /\.\.\./);
  assert.equal(maskAddress("whatsapp", "+6281234567890"), "+62••••••••890");
  assert.ok(!maskAddress("telegram", "555").includes("555"));
});
