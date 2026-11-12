// Telegram, through a bot made with @BotFather. Telegram calls our webhook with each
// update and proves it is Telegram by echoing the `secret_token` we registered.

import { timingSafeEqual } from "node:crypto";
import type { Channel, InboundMessage } from "./types";

const API = "https://api.telegram.org";

/** Constant-time check of the `X-Telegram-Bot-Api-Secret-Token` header. Fails closed. */
export function verifyTelegramSecret(header: string | null, expected: string | undefined): boolean {
  if (!header || !expected) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type TelegramUpdate = {
  update_id?: unknown;
  message?: {
    message_id?: unknown;
    text?: unknown;
    chat?: { id?: unknown; type?: unknown };
    reply_to_message?: { message_id?: unknown };
  };
};

/** The text message in an update, or null for anything else (edits, photos, group joins). */
export function parseTelegramUpdate(payload: unknown): InboundMessage | null {
  const u = payload as TelegramUpdate | null;
  const m = u?.message;
  if (!m || typeof m.text !== "string" || typeof m.message_id !== "number") return null;
  const chat = m.chat;
  if (!chat || (typeof chat.id !== "number" && typeof chat.id !== "string")) return null;
  const replyTo = m.reply_to_message?.message_id;
  return {
    kind: "telegram",
    address: String(chat.id),
    text: m.text,
    // update_id is unique per delivery; message ids repeat across chats.
    externalId: typeof u?.update_id === "number" ? `update:${u.update_id}` : `msg:${chat.id}:${m.message_id}`,
    replyToExternalId: typeof replyTo === "number" ? String(replyTo) : undefined,
    private: chat.type === "private",
  };
}

export const telegramChannel: Channel = {
  kind: "telegram",
  label: "Telegram",
  configured: () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET && process.env.TELEGRAM_BOT_USERNAME),
  parseInbound: parseTelegramUpdate,
  async send(address, text, opts) {
    const expectReply = opts?.expectReply ?? true;
    const res = await fetch(`${API}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // force_reply opens the reply box on the question, so the answer arrives as a reply to it.
      body: JSON.stringify(
        expectReply ? { chat_id: address, text, reply_markup: { force_reply: true, input_field_placeholder: "Your answer" } } : { chat_id: address, text },
      ),
      signal: AbortSignal.timeout(6000),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id?: number } };
    if (!res.ok || !body.ok || typeof body.result?.message_id !== "number") {
      // Never include the URL: it holds the bot token.
      throw new Error(`Telegram refused the message (${res.status}): ${body.description ?? "no reason given"}`);
    }
    return { externalId: String(body.result.message_id) };
  },
};

/** The deep link a seller taps to open the bot with their code. */
export function telegramLink(code: string, username = process.env.TELEGRAM_BOT_USERNAME ?? ""): string {
  return `https://t.me/${username.replace(/^@/, "")}?start=${code}`;
}
