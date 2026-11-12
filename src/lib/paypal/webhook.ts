// What a PayPal webhook means for FairBid. Pure: no database, no network, so every
// event shape is tested without PayPal.
//
// PayPal sends one of these when something changes on its side after our own call
// got its answer: a payment held for review completes or is denied days later, a
// hold lapses, a seller refunds from their own account. The route verifies the
// message, this file reads it, and `src/lib/paypal-sync.ts` writes the result.

export interface WebhookEvent {
  id?: string;
  event_type?: string;
  resource_type?: string;
  create_time?: string;
  resource?: {
    id?: string;
    status?: string;
    status_details?: { reason?: string };
    amount?: { currency_code?: string; value?: string };
    expiration_time?: string;
    final_capture?: boolean;
    links?: { rel?: string; href?: string }[];
    supplementary_data?: { related_ids?: { order_id?: string; authorization_id?: string } };
  };
}

/** The nine events the webhook subscribes to. Anything else is acknowledged and ignored. */
export const SUBSCRIBED_EVENTS = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
] as const;

export type Change =
  | { kind: "order_approved"; paypalOrderId: string }
  | { kind: "authorization"; paypalAuthId: string; status: string; expiresAt?: string }
  | { kind: "capture"; paypalCaptureId: string; status: string; reason?: string; paypalAuthId?: string }
  | { kind: "refund"; paypalCaptureId: string; refundId?: string; amountCents?: number; reversed: boolean };

/** A capture that paid nothing. The step can be paid again, with a new request id. */
export const FAILED_CAPTURE = new Set(["DECLINED", "DENIED", "FAILED"]);
export const isFailedCapture = (status: string | null | undefined) => FAILED_CAPTURE.has(status ?? "");

// A capture only moves forward. A late PENDING after COMPLETED, or a COMPLETED that
// arrives after the refund, must not roll the record back.
const CAPTURE_RANK: Record<string, number> = {
  PENDING: 1,
  COMPLETED: 2,
  DECLINED: 2,
  DENIED: 2,
  FAILED: 2,
  PARTIALLY_REFUNDED: 3,
  REFUNDED: 4,
};

export function nextCaptureStatus(current: string, incoming: string): string {
  return (CAPTURE_RANK[incoming] ?? 0) >= (CAPTURE_RANK[current] ?? 0) ? incoming : current;
}

/** PayPal's "value" is a decimal string such as "762.00"; FairBid keeps integer cents. */
export function parseCents(value: string | undefined): number | undefined {
  if (!value || !/^\d+(\.\d{1,2})?$/.test(value)) return undefined;
  const [whole, frac = ""] = value.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** For a refund, PayPal's resource is the refund itself; its "up" link names the capture. */
function captureFromLinks(event: WebhookEvent): string | undefined {
  const up = event.resource?.links?.find((l) => l.rel === "up")?.href;
  const m = up?.match(/\/v2\/payments\/captures\/([^/?#]+)/);
  return m?.[1];
}

/** Reads one event. Returns null for events FairBid does not act on. */
export function interpret(event: WebhookEvent): Change | null {
  const type = event.event_type ?? "";
  const r = event.resource ?? {};

  if (type === "CHECKOUT.ORDER.APPROVED") {
    return r.id ? { kind: "order_approved", paypalOrderId: r.id } : null;
  }

  if (type.startsWith("PAYMENT.AUTHORIZATION.")) {
    if (!r.id) return null;
    const status = type === "PAYMENT.AUTHORIZATION.VOIDED" ? "VOIDED" : (r.status ?? "CREATED");
    return { kind: "authorization", paypalAuthId: r.id, status, expiresAt: r.expiration_time };
  }

  if (type === "PAYMENT.CAPTURE.REFUNDED" || type === "PAYMENT.CAPTURE.REVERSED") {
    // Older payloads put the capture itself in the resource; newer ones the refund.
    const paypalCaptureId = event.resource_type === "capture" ? r.id : captureFromLinks(event) ?? r.id;
    if (!paypalCaptureId) return null;
    return {
      kind: "refund",
      paypalCaptureId,
      refundId: event.resource_type === "refund" ? r.id : undefined,
      amountCents: parseCents(r.amount?.value),
      reversed: type === "PAYMENT.CAPTURE.REVERSED",
    };
  }

  if (type.startsWith("PAYMENT.CAPTURE.")) {
    if (!r.id) return null;
    const status = type === "PAYMENT.CAPTURE.DENIED" ? "DENIED" : type === "PAYMENT.CAPTURE.DECLINED" ? "DECLINED" : (r.status ?? type.split(".")[2]);
    return {
      kind: "capture",
      paypalCaptureId: r.id,
      status,
      reason: r.status_details?.reason,
      paypalAuthId: r.supplementary_data?.related_ids?.authorization_id,
    };
  }

  return null;
}

/** PayPal's reason codes for a payment that is pending or denied, in the tender owner's words. */
export const REASONS: Record<string, string> = {
  ECHECK: "the tender owner paid by eCheck, which takes a few days to clear",
  PENDING_REVIEW: "PayPal is reviewing it",
  DECLINED_BY_RISK_FRAUD_FILTERS: "PayPal's fraud filters stopped it",
  INTERNATIONAL_WITHDRAWAL: "the bidder's account must accept international payments first",
  UNILATERAL: "the bidder's PayPal account is not confirmed",
  RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION: "the bidder must accept it in their PayPal account",
  VERIFICATION_REQUIRED: "the bidder's PayPal account must be verified first",
  TRANSACTION_APPROVED_AWAITING_FUNDING: "PayPal approved it and is waiting for the funds",
  BUYER_COMPLAINT: "the tender owner opened a complaint",
  CHARGEBACK: "the tender owner's bank reversed it",
  REFUNDED: "it was refunded",
  OTHER: "PayPal gave no reason",
};

export const reasonText = (reason: string | null | undefined) => (reason ? REASONS[reason] ?? reason.toLowerCase().replaceAll("_", " ") : undefined);
