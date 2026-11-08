import { NextResponse, type NextRequest } from "next/server";
import { appendEvent } from "@/lib/audit-store";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { createPayPalClient, loadConfig } from "@/lib/paypal/client";
import { isUniqueViolation } from "@/lib/workflow";

interface WebhookEvent {
  id?: string;
  event_type?: string;
  resource?: { id?: string; status?: string; supplementary_data?: { related_ids?: { authorization_id?: string } } };
}

/** Anything that stops verification, missing config included, counts as not genuine. */
async function isGenuine(req: NextRequest, event: WebhookEvent): Promise<boolean> {
  try {
    return await createPayPalClient(loadConfig()).verifyWebhook(req.headers, event);
  } catch {
    return false;
  }
}

/** PayPal retries until it gets a 2xx, so only a forged or unreadable request is
 * refused. An event we do not track is acknowledged and ignored. */
export async function POST(req: NextRequest) {
  let event: WebhookEvent;
  try {
    event = (await req.json()) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: { code: "bad_json", message: "Body is not JSON." } }, { status: 400 });
  }

  if (!(await isGenuine(req, event))) {
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
    await apply(event);
  } catch (error) {
    // Forget the delivery so PayPal's retry is processed, not skipped as a duplicate.
    log.error("webhook processing failed", error, { eventType: event.event_type, webhookEventId: event.id });
    if (event.id) await db.webhookEvent.delete({ where: { id: event.id } }).catch(() => undefined);
    return NextResponse.json({ error: { code: "processing_failed", message: "Try again." } }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}

/** Mirrors PayPal's view of a hold or capture we know about. Unknown ids are ignored. */
async function apply(event: WebhookEvent) {
  const authorizationId =
    event.event_type?.startsWith("PAYMENT.CAPTURE.")
      ? event.resource?.supplementary_data?.related_ids?.authorization_id
      : event.resource?.id;
  if (!authorizationId) return;

  const authorization = await db.authorization.findUnique({
    where: { paypalAuthId: authorizationId },
    include: { award: { select: { tenderId: true } } },
  });
  if (!authorization) return;

  if (event.event_type?.startsWith("PAYMENT.CAPTURE.") && event.resource?.id && event.resource.status) {
    await db.capture.updateMany({
      where: { paypalCaptureId: event.resource.id },
      data: { status: event.resource.status },
    });
  } else if (event.event_type?.startsWith("PAYMENT.AUTHORIZATION.") && event.resource?.status) {
    await db.authorization.update({ where: { id: authorization.id }, data: { status: event.resource.status } });
  }

  await appendEvent(authorization.award.tenderId, "paypal", event.event_type ?? "unknown", {
    webhookId: event.id,
    resourceId: event.resource?.id,
    status: event.resource?.status,
  });
}
