import { NextResponse, type NextRequest } from "next/server";
import { firstDelivery, forgetDelivery, handleInbound } from "@/lib/channels";
import { answerTap, inlineKeyboard, telegramChannel, verifyTelegramSecret } from "@/lib/channels/telegram";
import { log } from "@/lib/log";
import { createLimiter } from "@/lib/rate-limit";

const byChat = createLimiter(30, 60_000);

/** Telegram calls this for every message to the bot. It proves it is Telegram by echoing
 * the secret_token registered with setWebhook. A message we cannot use is acknowledged,
 * so Telegram does not keep retrying it. */
export async function POST(req: NextRequest) {
  if (!verifyTelegramSecret(req.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    log.warn("telegram webhook rejected");
    return NextResponse.json({ error: { code: "bad_secret", message: "Not verified." } }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "bad_json", message: "Body is not JSON." } }, { status: 400 });
  }
  const msg = telegramChannel.parseInbound(payload);
  if (!msg) return NextResponse.json({ ok: true });
  if (!byChat.hit(msg.address)) return NextResponse.json({ ok: true, limited: true });

  const id = `telegram:${msg.externalId}`;
  if (!(await firstDelivery(id, "telegram.message"))) return NextResponse.json({ ok: true, duplicate: true });
  try {
    const answer = await handleInbound(msg);
    // A tapped button spins until it is answered.
    if (msg.tap) await answerTap(msg.tap.id);
    if (!answer) return NextResponse.json({ ok: true });
    // Answering in the webhook response saves a second call to Telegram.
    const markup = answer.buttons ? inlineKeyboard(answer.buttons) : undefined;
    return NextResponse.json({ method: "sendMessage", chat_id: msg.address, text: answer.text, ...(markup ? { reply_markup: markup } : {}) });
  } catch (error) {
    log.error("telegram message failed", error);
    await forgetDelivery(id);
    return NextResponse.json({ error: { code: "processing_failed", message: "Try again." } }, { status: 500 });
  }
}
