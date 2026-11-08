// PayPal client: the only file that talks to PayPal. It has no void, refund or
// platform-fee call on purpose. With the seller as payee the sandbox refuses all
// three (DECISIONS.md, "No void"), so nothing here can promise them.

import { buildAuthorizeOrder, formatAmount, type AuthorizeOrderInput } from "./order";

const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issue?: string,
    readonly debugId?: string,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

export interface PayPalConfig {
  clientId: string;
  secret: string;
  webhookId?: string;
}

/** Fail closed: this codebase only ever moves sandbox money, so any other
 * PAYPAL_ENV stops here rather than reaching a live endpoint. */
export function loadConfig(env: Record<string, string | undefined> = process.env): PayPalConfig {
  if (env.PAYPAL_ENV !== "sandbox") {
    throw new Error(`PAYPAL_ENV must be "sandbox", got ${JSON.stringify(env.PAYPAL_ENV)}.`);
  }
  const clientId = env.PAYPAL_CLIENT_ID?.trim();
  const secret = env.PAYPAL_SECRET?.trim();
  if (!clientId || !secret) throw new Error("PAYPAL_CLIENT_ID and PAYPAL_SECRET are required.");
  return { clientId, secret, webhookId: env.PAYPAL_WEBHOOK_ID?.trim() || undefined };
}

type Fetch = typeof fetch;

export interface ClientOptions {
  /** Each attempt gives up after this long, so a stuck PayPal call cannot hold a request open. */
  timeoutMs?: number;
  /** Waits before each retry. Only safe requests are retried: GETs, the token, and
   * calls that carry a PayPal-Request-Id, which PayPal answers once however often it is sent. */
  retryDelaysMs?: number[];
}

/** A network failure or timeout: the request may or may not have reached PayPal. */
export class PayPalUnreachableError extends PayPalError {
  constructor(message: string) {
    super(message, 0, "UNREACHABLE");
    this.name = "PayPalUnreachableError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createPayPalClient(config: PayPalConfig, fetchImpl: Fetch = fetch, options: ClientOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const retryDelays = options.retryDelaysMs ?? [400, 1_500];
  let token: { value: string; expiresAt: number } | null = null;

  /** One HTTP exchange with retries on network errors, 429 and 5xx. Other errors return at once. */
  async function send(url: string, init: RequestInit, retryable: boolean): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const last = !retryable || attempt >= retryDelays.length;
      let res: Response;
      try {
        res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        if (last) {
          const why = error instanceof Error && error.name === "TimeoutError" ? "did not answer in time" : "could not be reached";
          throw new PayPalUnreachableError(`PayPal ${why}.`);
        }
        await sleep(retryDelays[attempt]);
        continue;
      }
      if (last || (res.status < 500 && res.status !== 429)) return res;
      await sleep(retryDelays[attempt]);
    }
  }

  async function accessToken(): Promise<string> {
    if (token && Date.now() < token.expiresAt) return token.value;
    const basic = Buffer.from(`${config.clientId}:${config.secret}`).toString("base64");
    const res = await send(
      `${SANDBOX_BASE}/v1/oauth2/token`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
      },
      true,
    );
    if (!res.ok) throw new PayPalError("PayPal refused the client credentials.", res.status);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    // Renew a minute early so a token cannot expire mid-request.
    token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
    return token.value;
  }

  async function call<T>(path: string, init: { method: string; body?: unknown; rawBody?: string; requestId?: string }): Promise<T> {
    const res = await send(
      `${SANDBOX_BASE}${path}`,
      {
        method: init.method,
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
          // PayPal treats a repeat with the same id as the same request, so a retry
          // after a timeout cannot capture twice.
          ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
        },
        body: init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
      },
      init.method === "GET" || Boolean(init.requestId),
    );
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      // A gateway error page instead of JSON.
      if (res.ok) throw new PayPalError("PayPal sent an unreadable answer.", res.status);
    }
    if (!res.ok) {
      const details = parsed.details as { issue?: string }[] | undefined;
      throw new PayPalError(
        String(parsed.message ?? `PayPal returned ${res.status}.`),
        res.status,
        details?.[0]?.issue ?? (parsed.name as string | undefined),
        parsed.debug_id as string | undefined,
      );
    }
    return parsed as T;
  }

  return {
    accessToken,

    createAuthorizeOrder(input: AuthorizeOrderInput, requestId: string) {
      return call<{ id: string; status: string }>("/v2/checkout/orders", {
        method: "POST",
        body: buildAuthorizeOrder(input),
        requestId,
      });
    },

    authorizeOrder(orderId: string, requestId: string) {
      return call<{
        id: string;
        status: string;
        purchase_units: { payments: { authorizations: { id: string; status: string; expiration_time: string }[] } }[];
      }>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, { method: "POST", body: {}, requestId });
    },

    /** Partial capture per milestone. `finalCapture` closes the hold and
     * releases anything left back to the buyer. */
    captureAuthorization(input: {
      authorizationId: string;
      currency: string;
      amountCents: number;
      finalCapture: boolean;
      requestId: string;
    }) {
      return call<{ id: string; status: string; status_details?: { reason?: string } }>(
        `/v2/payments/authorizations/${encodeURIComponent(input.authorizationId)}/capture`,
        {
          method: "POST",
          body: {
            amount: { currency_code: input.currency, value: formatAmount(input.amountCents) },
            final_capture: input.finalCapture,
          },
          requestId: input.requestId,
        },
      );
    },

    /** The order with its authorizations, to recover a hold whose answer was lost. */
    getOrder(orderId: string) {
      return call<{
        id: string;
        status: string;
        purchase_units?: { payments?: { authorizations?: { id: string; status: string; expiration_time?: string }[] } }[];
      }>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
    },

    getAuthorization(authorizationId: string) {
      return call<{ id: string; status: string; expiration_time?: string }>(
        `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`,
        { method: "GET" },
      );
    },

    /** Asks PayPal whether a webhook is genuine. Fails closed with no webhook id.
     * `rawBody` is the request body exactly as received: the signature covers those
     * bytes, and a parsed-then-reserialized copy can fail verification. */
    async verifyWebhook(headers: Headers, rawBody: string): Promise<boolean> {
      if (!config.webhookId) return false;
      const fields = {
        auth_algo: headers.get("paypal-auth-algo"),
        cert_url: headers.get("paypal-cert-url"),
        transmission_id: headers.get("paypal-transmission-id"),
        transmission_sig: headers.get("paypal-transmission-sig"),
        transmission_time: headers.get("paypal-transmission-time"),
        webhook_id: config.webhookId,
      };
      if (Object.values(fields).some((v) => !v)) return false;
      const result = await call<{ verification_status: string }>("/v1/notifications/verify-webhook-signature", {
        method: "POST",
        rawBody: `${JSON.stringify(fields).slice(0, -1)},"webhook_event":${rawBody}}`,
      });
      return result.verification_status === "SUCCESS";
    },
  };
}

export type PayPalClient = ReturnType<typeof createPayPalClient>;
