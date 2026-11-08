// WhatsApp through Twilio (the sandbox is enough for the demo). Twilio posts each
// inbound message as a form and signs it with HMAC-SHA1 over the public URL and the
// sorted fields, using the account's auth token.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Channel, InboundMessage } from "./types";

/** Twilio's `X-Twilio-Signature` for a form post to `url`. */
export function twilioSignature(authToken: string, url: string, params: URLSearchParams): string {
  const keys = [...new Set(params.keys())].sort();
  let data = url;
  for (const k of keys) for (const v of params.getAll(k).sort()) data += k + v;
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

/** Constant-time check of the signature header. Fails closed when anything is missing. */
export function verifyTwilioSignature(header: string | null, authToken: string | undefined, url: string | undefined, params: URLSearchParams): boolean {
  if (!header || !authToken || !url) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(twilioSignature(authToken, url, params));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** "whatsapp:+62 812-34" → "+6281234". Null for anything that is not a number. */
export function normalizeWhatsApp(raw: string): string | null {
  const digits = raw.replace(/^whatsapp:/i, "").replace(/[^\d]/g, "");
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
}

/** Numbers allowed to link, from `CHANNEL_ALLOWLIST`. Separate them with semicolons or commas
 * (in the deploy workflow only semicolons work: gcloud splits variables at commas). Empty means none. */
export function parseAllowlist(raw: string | undefined): Set<string> {
  return new Set((raw ?? "").split(/[;,]/).map((n) => normalizeWhatsApp(n.trim())).filter((n): n is string => n !== null));
}

/** The form fields of an inbound WhatsApp message. */
export function parseWhatsAppForm(payload: unknown): InboundMessage | null {
  if (!(payload instanceof URLSearchParams)) return null;
  const from = normalizeWhatsApp(payload.get("From") ?? "");
  const body = payload.get("Body");
  const sid = payload.get("MessageSid");
  if (!from || body === null || !sid) return null;
  return {
    kind: "whatsapp",
    address: from,
    text: body,
    externalId: sid,
    replyToExternalId: payload.get("OriginalRepliedMessageSid") || undefined,
    // Twilio's WhatsApp senders are always one person's number.
    private: true,
  };
}

/** Wraps text in TwiML, which Twilio sends back to the sender as the answer to the webhook. */
export function twiml(message: string): string {
  const escaped = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

export const whatsappChannel: Channel = {
  kind: "whatsapp",
  label: "WhatsApp",
  // Off unless WHATSAPP_ENABLED=true, even with every Twilio setting present: a Twilio trial
  // account cannot send, so the channel stays hidden until the account can (DECISIONS.md).
  configured: () =>
    process.env.WHATSAPP_ENABLED === "true" &&
    Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM && process.env.PUBLIC_BASE_URL),
  parseInbound: parseWhatsAppForm,
  async send(address, text) {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const from = normalizeWhatsApp(process.env.TWILIO_WHATSAPP_FROM ?? "");
    if (!from) throw new Error("TWILIO_WHATSAPP_FROM is not a phone number.");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: `whatsapp:${from}`, To: `whatsapp:${address}`, Body: text }),
      signal: AbortSignal.timeout(6000),
    });
    const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (!res.ok || !body.sid) throw new Error(`Twilio refused the message (${res.status}, code ${body.code ?? "none"}): ${body.message ?? "no reason given"}`);
    return { externalId: body.sid };
  },
};
