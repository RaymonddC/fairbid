import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPayPalClient, loadConfig, PayPalError, PayPalUnreachableError } from "../paypal/client";
import { buildAuthorizeOrder, formatAmount, orderTotalCents, type AuthorizeOrderInput } from "../paypal/order";

const ORDER: AuthorizeOrderInput = {
  referenceId: "tender-1",
  description: "300 handmade batik napkins",
  currency: "EUR",
  payeeEmail: "sari@example.com",
  items: [{ name: "Batik napkin", quantity: 300, unitAmountCents: 763 }],
  shippingCents: 25_000,
  taxCents: 27_500,
  handlingCents: 6_500,
};

describe("order body", () => {
  it("always makes the seller the payee", () => {
    const unit = buildAuthorizeOrder(ORDER).purchase_units[0];
    assert.deepEqual(unit.payee, { email_address: "sari@example.com" });
  });

  it("requests an authorization, not an immediate capture", () => {
    assert.equal(buildAuthorizeOrder(ORDER).intent, "AUTHORIZE");
  });

  it("has a breakdown that adds up to the amount", () => {
    const { amount } = buildAuthorizeOrder(ORDER).purchase_units[0];
    const { item_total, shipping, tax_total, handling } = amount.breakdown;
    const sum = [item_total, shipping, tax_total, handling].reduce((total, part) => total + Math.round(Number(part.value) * 100), 0);
    assert.equal(Math.round(Number(amount.value) * 100), sum);
    assert.equal(amount.value, formatAmount(orderTotalCents(ORDER)));
  });

  it("formats cents exactly", () => {
    assert.equal(formatAmount(288_050), "2880.50");
    assert.equal(formatAmount(5), "0.05");
    assert.equal(formatAmount(0), "0.00");
    assert.throws(() => formatAmount(1.5));
  });
});

describe("safety gate", () => {
  const CREDENTIALS = { PAYPAL_CLIENT_ID: "id", PAYPAL_SECRET: "secret" };

  it("refuses anything but sandbox", () => {
    for (const env of [undefined, "", "live", "production", "SANDBOX"]) {
      assert.throws(() => loadConfig({ ...CREDENTIALS, PAYPAL_ENV: env }), /must be "sandbox"/);
    }
  });

  it("refuses a missing or blank credential", () => {
    assert.throws(() => loadConfig({ PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "id" }));
    assert.throws(() => loadConfig({ PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "id", PAYPAL_SECRET: "   " }));
  });
});

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  const queue = [{ body: { access_token: "token", expires_in: 3600 } }, ...responses];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    assert.ok(next, `unexpected call to ${url}`);
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const CONFIG = { clientId: "id", secret: "secret", webhookId: "wh" };
const SIGNED = new Headers({
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  "paypal-transmission-id": "tid-1",
  "paypal-transmission-sig": "sig==",
  "paypal-transmission-time": "2026-11-08T05:00:00Z",
});

describe("client", () => {
  it("only ever calls the sandbox host", async () => {
    const { impl, calls } = fakeFetch([{ body: { id: "ORDER", status: "CREATED" } }]);
    await createPayPalClient(CONFIG, impl).createAuthorizeOrder(ORDER, "req-1");
    for (const call of calls) assert.ok(call.url.startsWith("https://api-m.sandbox.paypal.com/"));
  });

  it("sends the final-capture flag and an idempotency key", async () => {
    const { impl, calls } = fakeFetch([{ body: { id: "CAP", status: "COMPLETED" } }]);
    await createPayPalClient(CONFIG, impl).captureAuthorization({
      authorizationId: "AUTH",
      currency: "EUR",
      amountCents: 86_400,
      finalCapture: true,
      requestId: "milestone-3",
    });
    const capture = calls[1];
    assert.ok(capture.url.endsWith("/v2/payments/authorizations/AUTH/capture"));
    assert.deepEqual(JSON.parse(String(capture.init.body)), {
      amount: { currency_code: "EUR", value: "864.00" },
      final_capture: true,
    });
    assert.equal(new Headers(capture.init.headers).get("PayPal-Request-Id"), "milestone-3");
  });

  it("offers no void, refund or fee call", () => {
    const client = createPayPalClient(CONFIG, fakeFetch([]).impl);
    for (const name of Object.keys(client)) assert.doesNotMatch(name, /void|refund|fee/i);
  });

  it("surfaces PayPal's issue code", async () => {
    const { impl } = fakeFetch([
      { status: 403, body: { name: "NOT_AUTHORIZED", message: "No permission.", details: [{ issue: "PERMISSION_DENIED" }], debug_id: "dbg" } },
    ]);
    await assert.rejects(
      () => createPayPalClient(CONFIG, impl).getAuthorization("AUTH"),
      (error: unknown) => error instanceof PayPalError && error.status === 403 && error.issue === "PERMISSION_DENIED",
    );
  });

  it("retries a 503 with the same idempotency key, then succeeds", async () => {
    const { impl, calls } = fakeFetch([
      { status: 503, body: { name: "SERVICE_UNAVAILABLE" } },
      { body: { id: "CAP", status: "COMPLETED" } },
    ]);
    const cap = await createPayPalClient(CONFIG, impl, { retryDelaysMs: [0, 0] }).captureAuthorization({
      authorizationId: "AUTH",
      currency: "EUR",
      amountCents: 100,
      finalCapture: false,
      requestId: "milestone-1",
    });
    assert.equal(cap.id, "CAP");
    const keys = calls.slice(1).map((c) => new Headers(c.init.headers).get("PayPal-Request-Id"));
    assert.deepEqual(keys, ["milestone-1", "milestone-1"]);
  });

  it("never retries a request that has no idempotency key", async () => {
    const { impl, calls } = fakeFetch([{ status: 503, body: { name: "SERVICE_UNAVAILABLE" } }]);
    await assert.rejects(() => createPayPalClient(CONFIG, impl, { retryDelaysMs: [0, 0] }).verifyWebhook(SIGNED, "{}"));
    assert.equal(calls.length, 2); // token + one attempt
  });

  it("does not retry a 4xx", async () => {
    const { impl, calls } = fakeFetch([{ status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "AUTHORIZATION_EXPIRED" }] } }]);
    await assert.rejects(
      () => createPayPalClient(CONFIG, impl, { retryDelaysMs: [0, 0] }).getAuthorization("AUTH"),
      (e: unknown) => e instanceof PayPalError && e.issue === "AUTHORIZATION_EXPIRED",
    );
    assert.equal(calls.length, 2);
  });

  it("gives up on a network failure with a clear error", async () => {
    let n = 0;
    const impl = (async () => {
      n++;
      if (n === 1) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await assert.rejects(
      () => createPayPalClient(CONFIG, impl, { retryDelaysMs: [0, 0] }).getOrder("ORDER"),
      (e: unknown) => e instanceof PayPalUnreachableError && e.issue === "UNREACHABLE",
    );
    assert.equal(n, 4); // token + three attempts
  });

  it("times out a call that never answers", async () => {
    const impl = ((url: string, init: RequestInit) =>
      url.endsWith("/oauth2/token")
        ? Promise.resolve(new Response(JSON.stringify({ access_token: "t", expires_in: 3600 })))
        : new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as typeof fetch;
    await assert.rejects(
      () => createPayPalClient(CONFIG, impl, { timeoutMs: 20, retryDelaysMs: [] }).getOrder("ORDER"),
      (e: unknown) => e instanceof PayPalUnreachableError && /in time/.test(e.message),
    );
  });

  it("turns a gateway error page into a PayPal error", async () => {
    const impl = (async (url: string) =>
      url.endsWith("/oauth2/token")
        ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }))
        : new Response("<html>Bad gateway</html>", { status: 502 })) as typeof fetch;
    await assert.rejects(
      () => createPayPalClient(CONFIG, impl, { retryDelaysMs: [] }).getOrder("ORDER"),
      (e: unknown) => e instanceof PayPalError && e.status === 502,
    );
  });

  it("rejects webhooks when no webhook id is configured", async () => {
    const client = createPayPalClient({ clientId: "id", secret: "secret" }, fakeFetch([]).impl);
    assert.equal(await client.verifyWebhook(SIGNED, "{}"), false);
  });

  it("rejects a webhook missing a signature header without asking PayPal", async () => {
    const { impl, calls } = fakeFetch([]);
    assert.equal(await createPayPalClient(CONFIG, impl).verifyWebhook(new Headers(), "{}"), false);
    assert.equal(calls.length, 0);
  });

  it("sends the webhook body to PayPal byte for byte, inside the verification request", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { verification_status: "SUCCESS" } }]);
    const raw = '{"id":"WH-1","resource":{"amount":{"value":"762.00"}},"event_type":"PAYMENT.CAPTURE.COMPLETED"}';
    assert.equal(await createPayPalClient(CONFIG, impl).verifyWebhook(SIGNED, raw), true);
    const sent = String(calls[1].init.body);
    assert.ok(sent.endsWith(`,"webhook_event":${raw}}`), sent);
    const parsed = JSON.parse(sent) as Record<string, unknown>;
    assert.equal(parsed.webhook_id, "wh");
    assert.equal(parsed.transmission_id, "tid-1");
    assert.deepEqual(parsed.webhook_event, JSON.parse(raw));
  });
});
