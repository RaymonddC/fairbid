import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { createPayPalClient, loadConfig } from "@/lib/paypal/client";
import { type WebhookEvent } from "@/lib/paypal/webhook";
import { applyWebhook } from "@/lib/paypal-sync";
import { createLimiter } from "@/lib/rate-limit";
import { isUniqueViolation } from "@/lib/workflow";

// Every request costs one verification call to PayPal, so a flood from one address
// is turned away before that. PayPal's own retries are far below this.
const byIp = createLimiter(120, 60_000);

/** Anything that stops verification, missing config included, counts as not genuine. */
async function isGenuine(headers: Headers, rawBody: string): Promise<boolean> {
  try {
    return await createPayPalClient(loadConfig()).verifyWebhook(headers, rawBody);
  } catch {
    return false;
  }
}

/** PayPal retries until it gets a 2xx, up to 25 times over 3 days, so only a forged
 * or unreadable request is refused. An event we do not track is acknowledged and ignored. */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
  if (!byIp.hit(ip)) {
    return NextResponse.json({ error: { code: "rate_limited", message: "Too many requests." } }, { status: 429 });
  }

  const raw = await req.text();
  let event: WebhookEvent;
  try {
    event = JSON.parse(raw) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: { code: "bad_json", message: "Body is not JSON." } }, { status: 400 });
  }

  if (!(await isGenuine(req.headers, raw))) {
    log.warn("webhook rejected", { eventType: event.event_type, webhookEventId: event.id });
    return NextResponse.json({ error: { code: "bad_signature", message: "Signature not verified." } }, { status: 401 });
  }

  // A repeat delivery of an event already handled is acknowledged and ignored.
  if (event.id) {
    try {
      await db.webhookEvent.create({ data: { id: event.id, eventType: event.event_type ?? "unknown" } });
    } catch (error) {
      if (isUniqueViolation(error)) return NextResponse.json({ received: true, duplicate: true });
      throw error;
    }
  }

  try {
    const tenderId = await applyWebhook(event);
    log.info("webhook applied", { eventType: event.event_type, webhookEventId: event.id, tenderId, matched: tenderId !== null });
  } catch (error) {
    // Forget the delivery so PayPal's retry is processed, not skipped as a duplicate.
    log.error("webhook processing failed", error, { eventType: event.event_type, webhookEventId: event.id });
    if (event.id) await db.webhookEvent.delete({ where: { id: event.id } }).catch(() => undefined);
    return NextResponse.json({ error: { code: "processing_failed", message: "Try again." } }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
