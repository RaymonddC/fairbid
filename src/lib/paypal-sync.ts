// Writes what a verified PayPal webhook says into FairBid's records, and into the
// tender's event log as actor "paypal": a second witness to every money step, one
// FairBid did not write itself.
//
// Rules: a record only moves forward (a late PENDING never undoes a COMPLETED), a hold
// our own final capture closed stays CAPTURED, and a payment PayPal denies after the
// fact reopens its step so the buyer can pay it again.

import { appendEvent } from "./audit-store";
import { db } from "./db";
import { log } from "./log";
import { interpret, isFailedCapture, nextCaptureStatus, type WebhookEvent } from "./paypal/webhook";
import { assertTransition } from "./tender";

/** Applies one verified event. Returns the tender it touched, or null when the event
 * is about something FairBid does not know, which is acknowledged and ignored. */
export async function applyWebhook(event: WebhookEvent): Promise<string | null> {
  const change = interpret(event);
  if (!change) return null;
  const note = { webhookId: event.id, eventType: event.event_type };

  switch (change.kind) {
    case "order_approved": {
      const auth = await db.authorization.findUnique({
        where: { paypalOrderId: change.paypalOrderId },
        include: { award: { select: { tenderId: true } } },
      });
      if (!auth) return null;
      await appendEvent(auth.award.tenderId, "paypal", "paypal.order.approved", { ...note, paypalOrderId: change.paypalOrderId });
      return auth.award.tenderId;
    }

    case "authorization": {
      const auth = await db.authorization.findUnique({
        where: { paypalAuthId: change.paypalAuthId },
        include: { award: { select: { tenderId: true } } },
      });
      if (!auth) return null;
      const tenderId = auth.award.tenderId;
      let status = auth.status;
      // A hold our own final capture closed is done, whatever PayPal reports afterwards.
      if (auth.status !== "CAPTURED") {
        const lapsed = change.status === "VOIDED" && auth.expiresAt && auth.expiresAt.getTime() <= Date.now();
        status = lapsed ? "EXPIRED" : change.status;
        if (status !== auth.status) await db.authorization.update({ where: { id: auth.id }, data: { status } });
      }
      await appendEvent(tenderId, "paypal", change.status === "VOIDED" ? "paypal.hold.released" : "paypal.hold.confirmed", {
        ...note,
        paypalAuthId: change.paypalAuthId,
        status,
        amountCents: auth.amountCents,
      });
      return tenderId;
    }

    case "capture": {
      const cap = await captureByPayPalId(change.paypalCaptureId);
      if (!cap) {
        log.warn("webhook names a capture FairBid did not make", { ...note, paypalCaptureId: change.paypalCaptureId });
        return null;
      }
      const tenderId = cap.authorization.award.tenderId;
      const status = nextCaptureStatus(cap.status, change.status);
      const reason = change.reason ?? (status === "COMPLETED" ? null : cap.statusReason);
      if (status !== cap.status || reason !== cap.statusReason) {
        await db.$transaction(async (tx) => {
          await tx.capture.update({ where: { id: cap.id }, data: { status, statusReason: reason } });
          if (isFailedCapture(status) && !isFailedCapture(cap.status)) {
            // The step was recorded as paid; PayPal now says nothing was paid.
            await tx.milestone.update({ where: { id: cap.milestoneId }, data: { status: "pending" } });
            if (cap.finalCapture && cap.authorization.award.tender.status === "COMPLETE") {
              assertTransition("COMPLETE", "IN_DELIVERY");
              await tx.tender.updateMany({ where: { id: tenderId, status: "COMPLETE" }, data: { status: "IN_DELIVERY" } });
            }
          }
        });
      }
      const kind = isFailedCapture(status) ? "paypal.payment.denied" : status === "PENDING" ? "paypal.payment.pending" : "paypal.payment.completed";
      await appendEvent(tenderId, "paypal", kind, {
        ...note,
        milestone: cap.milestone.name,
        amountCents: cap.amountCents,
        status,
        reason: change.reason,
        paypalCaptureId: change.paypalCaptureId,
      });
      return tenderId;
    }

    case "refund": {
      const cap = await captureByPayPalId(change.paypalCaptureId);
      if (!cap) return null;
      const tenderId = cap.authorization.award.tenderId;
      // Without an amount, PayPal reversed the whole capture.
      const amount = change.amountCents ?? cap.amountCents - cap.refundedCents;
      const refundedCents = Math.min(cap.amountCents, cap.refundedCents + amount);
      const status = nextCaptureStatus(cap.status, refundedCents >= cap.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED");
      await db.capture.update({ where: { id: cap.id }, data: { status, refundedCents } });
      await appendEvent(tenderId, "paypal", change.reversed ? "paypal.payment.reversed" : "paypal.payment.refunded", {
        ...note,
        milestone: cap.milestone.name,
        amountCents: amount,
        refundedCents,
        paypalCaptureId: change.paypalCaptureId,
        refundId: change.refundId,
      });
      return tenderId;
    }
  }
}

function captureByPayPalId(paypalCaptureId: string) {
  return db.capture.findUnique({
    where: { paypalCaptureId },
    include: {
      milestone: { select: { name: true } },
      authorization: { select: { award: { select: { tenderId: true, tender: { select: { status: true } } } } } },
    },
  });
}
