import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interpret, isFailedCapture, nextCaptureStatus, parseCents, reasonText, SUBSCRIBED_EVENTS } from "../paypal/webhook";

describe("PayPal webhook reading", () => {
  it("reads a completed capture with the hold it came from", () => {
    const c = interpret({
      id: "WH-1",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource_type: "capture",
      resource: { id: "CAP1", status: "COMPLETED", supplementary_data: { related_ids: { authorization_id: "AUTH1", order_id: "ORD1" } } },
    });
    assert.deepEqual(c, { kind: "capture", paypalCaptureId: "CAP1", status: "COMPLETED", reason: undefined, paypalAuthId: "AUTH1" });
  });

  it("keeps PayPal's reason for a pending or denied capture", () => {
    const pending = interpret({ event_type: "PAYMENT.CAPTURE.PENDING", resource: { id: "CAP1", status: "PENDING", status_details: { reason: "ECHECK" } } });
    assert.equal(pending?.kind === "capture" && pending.reason, "ECHECK");
    // DENIED and DECLINED events may carry no status; the event name is the status.
    const denied = interpret({ event_type: "PAYMENT.CAPTURE.DENIED", resource: { id: "CAP1" } });
    assert.equal(denied?.kind === "capture" && denied.status, "DENIED");
    const declined = interpret({ event_type: "PAYMENT.CAPTURE.DECLINED", resource: { id: "CAP1" } });
    assert.equal(declined?.kind === "capture" && declined.status, "DECLINED");
  });

  it("finds the capture a refund belongs to through the resource's up link", () => {
    const c = interpret({
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource_type: "refund",
      resource: {
        id: "REF1",
        status: "COMPLETED",
        amount: { currency_code: "EUR", value: "100.50" },
        links: [
          { rel: "self", href: "https://api.sandbox.paypal.com/v2/payments/refunds/REF1" },
          { rel: "up", href: "https://api.sandbox.paypal.com/v2/payments/captures/CAP9" },
        ],
      },
    });
    assert.deepEqual(c, { kind: "refund", paypalCaptureId: "CAP9", refundId: "REF1", amountCents: 10050, reversed: false });
  });

  it("reads an older refund payload whose resource is the capture itself", () => {
    const c = interpret({ event_type: "PAYMENT.CAPTURE.REVERSED", resource_type: "capture", resource: { id: "CAP2", status: "REFUNDED" } });
    assert.equal(c?.kind, "refund");
    assert.equal(c?.kind === "refund" && c.paypalCaptureId, "CAP2");
    assert.equal(c?.kind === "refund" && c.reversed, true);
  });

  it("reads a voided hold as VOIDED whatever the resource says", () => {
    const c = interpret({ event_type: "PAYMENT.AUTHORIZATION.VOIDED", resource: { id: "AUTH1", status: "CREATED" } });
    assert.deepEqual(c, { kind: "authorization", paypalAuthId: "AUTH1", status: "VOIDED", expiresAt: undefined });
    const created = interpret({ event_type: "PAYMENT.AUTHORIZATION.CREATED", resource: { id: "AUTH1", status: "PENDING", expiration_time: "2026-12-07T00:00:00Z" } });
    assert.deepEqual(created, { kind: "authorization", paypalAuthId: "AUTH1", status: "PENDING", expiresAt: "2026-12-07T00:00:00Z" });
  });

  it("reads the buyer's approval of an order", () => {
    assert.deepEqual(interpret({ event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "ORD1" } }), { kind: "order_approved", paypalOrderId: "ORD1" });
  });

  it("ignores events it does not act on, and events with no resource id", () => {
    assert.equal(interpret({ event_type: "BILLING.PLAN.CREATED", resource: { id: "P-1" } }), null);
    assert.equal(interpret({ event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} }), null);
    assert.equal(interpret({}), null);
  });

  it("acts on every event the webhook subscribes to", () => {
    for (const type of SUBSCRIBED_EVENTS) {
      assert.notEqual(interpret({ event_type: type, resource_type: "capture", resource: { id: "X", status: "COMPLETED" } }), null, type);
    }
  });
});

describe("capture status order", () => {
  it("moves forward only", () => {
    assert.equal(nextCaptureStatus("PENDING", "COMPLETED"), "COMPLETED");
    assert.equal(nextCaptureStatus("COMPLETED", "PENDING"), "COMPLETED");
    assert.equal(nextCaptureStatus("COMPLETED", "REFUNDED"), "REFUNDED");
    assert.equal(nextCaptureStatus("REFUNDED", "COMPLETED"), "REFUNDED");
    assert.equal(nextCaptureStatus("PARTIALLY_REFUNDED", "REFUNDED"), "REFUNDED");
    assert.equal(nextCaptureStatus("PENDING", "DENIED"), "DENIED");
  });

  it("knows which captures paid nothing", () => {
    assert.equal(isFailedCapture("DENIED"), true);
    assert.equal(isFailedCapture("DECLINED"), true);
    assert.equal(isFailedCapture("FAILED"), true);
    assert.equal(isFailedCapture("PENDING"), false);
    assert.equal(isFailedCapture("COMPLETED"), false);
    assert.equal(isFailedCapture(null), false);
  });
});

describe("PayPal amounts and reasons", () => {
  it("turns PayPal's decimal strings into cents", () => {
    assert.equal(parseCents("762.00"), 76200);
    assert.equal(parseCents("0.5"), 50);
    assert.equal(parseCents("2539"), 253900);
    assert.equal(parseCents("abc"), undefined);
    assert.equal(parseCents(undefined), undefined);
  });

  it("puts reasons in plain words and never shows a bare code", () => {
    assert.equal(reasonText("ECHECK"), "the buyer paid by eCheck, which takes a few days to clear");
    assert.equal(reasonText("SOME_NEW_CODE"), "some new code");
    assert.equal(reasonText(undefined), undefined);
  });
});
