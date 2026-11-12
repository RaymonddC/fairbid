// Telegram, through a bot made with @BotFather. Telegram calls our webhook with each
// update and proves it is Telegram by echoing the `secret_token` we registered.

import { timingSafeEqual } from "node:crypto";
import type { Button, Channel, InboundMessage } from "./types";

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
  callback_query?: {
    id?: unknown;
    data?: unknown;
    message?: { message_id?: unknown; chat?: { id?: unknown; type?: unknown } };
  };
};

/** The text message in an update, or a tap on one of our buttons; null for anything else
 * (edits, photos, group joins). A tap carries the button's data as its text. */
export function parseTelegramUpdate(payload: unknown): InboundMessage | null {
  const u = payload as TelegramUpdate | null;
  const tap = u?.callback_query;
  if (tap) {
    const chat = tap.message?.chat;
    if (typeof tap.id !== "string" || typeof tap.data !== "string" || !chat || (typeof chat.id !== "number" && typeof chat.id !== "string")) return null;
    return {
      kind: "telegram",
      address: String(chat.id),
      text: tap.data,
      externalId: typeof u?.update_id === "number" ? `update:${u.update_id}` : `tap:${tap.id}`,
      private: chat.type === "private",
      tap: { id: tap.id, data: tap.data },
    };
  }
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

type InlineButton = { text: string; callback_data: string } | { text: string; url: string };

/** Telegram's inline keyboard for our buttons. A link button needs a public https address,
 * so one pointing anywhere else (a local server) is left out rather than refused. */
export function inlineKeyboard(rows: Button[][]): { inline_keyboard: InlineButton[][] } | undefined {
  const keyboard = rows
    .map((row) =>
      row.flatMap((b): InlineButton[] => ("url" in b ? (/^https:\/\//.test(b.url) ? [{ text: b.text, url: b.url }] : []) : [{ text: b.text, callback_data: b.data.slice(0, 64) }])),
    )
    .filter((row) => row.length > 0);
  return keyboard.length ? { inline_keyboard: keyboard } : undefined;
}

async function call(method: string, body: Record<string, unknown>): Promise<{ ok?: boolean; description?: string; result?: { message_id?: number } }> {
  const res = await fetch(`${API}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id?: number } };
  // Never include the URL: it holds the bot token.
  if (!res.ok || !json.ok) throw new Error(`Telegram refused ${method} (${res.status}): ${json.description ?? "no reason given"}`);
  return json;
}

/** Stops the spinner on a tapped button, with a short note when there is one. Never throws. */
export async function answerTap(tapId: string, text?: string): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: tapId, ...(text ? { text: text.slice(0, 190) } : {}) }).catch(() => undefined);
}

/** The commands Telegram lists under "/" in this one chat, for the sides it is linked to. Never throws. */
export async function setChatCommands(chatId: string, commands: { command: string; description: string }[]): Promise<void> {
  await call("setMyCommands", { commands, scope: { type: "chat", chat_id: chatId } }).catch(() => undefined);
}

export const telegramChannel: Channel = {
  kind: "telegram",
  label: "Telegram",
  configured: () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET && process.env.TELEGRAM_BOT_USERNAME),
  parseInbound: parseTelegramUpdate,
  async send(address, text, opts) {
    const keyboard = opts?.buttons ? inlineKeyboard(opts.buttons) : undefined;
    const expectReply = (opts?.expectReply ?? true) && !opts?.buttons;
    // force_reply opens the reply box on the question, so the answer arrives as a reply to it.
    const markup = keyboard ?? (expectReply ? { force_reply: true, input_field_placeholder: "Your answer" } : undefined);
    const body = await call("sendMessage", { chat_id: address, text, ...(markup ? { reply_markup: markup } : {}) }).catch((error: Error) => {
      throw new Error(error.message.replace("refused sendMessage", "refused the message"));
    });
    if (typeof body.result?.message_id !== "number") throw new Error("Telegram refused the message: no message id");
    return { externalId: String(body.result.message_id) };
  },
};

/** The deep link a seller taps to open the bot with their code. */
export function telegramLink(code: string, username = process.env.TELEGRAM_BOT_USERNAME ?? ""): string {
  return `https://t.me/${username.replace(/^@/, "")}?start=${code}`;
}

/**
 * Makes sure Telegram sends this app button taps as well as messages. A webhook registered
 * before the bot had buttons takes messages only. Changes nothing unless Telegram's webhook
 * already points at this site's own public address, so a local server never moves it.
 * Never throws.
 */
export async function ensureTapUpdates(): Promise<void> {
  const base = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!telegramChannel.configured() || !base?.startsWith("https://") || !secret) return;
  try {
    const info = (await call("getWebhookInfo", {})) as { result?: { url?: string; allowed_updates?: string[] } };
    const url = `${base}/api/webhooks/telegram`;
    const allowed = info.result?.allowed_updates ?? [];
    if (info.result?.url !== url || allowed.length === 0 || allowed.includes("callback_query")) return;
    await call("setWebhook", { url, secret_token: secret, allowed_updates: [...new Set([...allowed, "message", "callback_query"])] });
  } catch {
    // The bot still takes messages; buttons wait for the next start.
  }
}
