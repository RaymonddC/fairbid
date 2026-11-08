// Proof, from PayPal's own records, that FairBid's holds and payments are what the app says.
// Reads real sandbox authorizations back from PayPal (GET only: nothing is created, captured
// or released) and checks each claim we make in the README, the pitch and the UI:
//
//   1. The order is an authorization (a hold), not an immediate sale.
//   2. The seller is the payee on the order and the hold. FairBid never receives the money.
//   3. A hold lasts 29 days, so no hold is asked to outlive it (one hold per phase).
//   4. Payments never take more than was held.
//   5. FairBid takes no platform fee from any payment.
//   6. After a final capture the hold is closed, and anything not paid out was never charged.
//
//   npx tsx --env-file=.env sandbox-tests/readback.ts            # every case in cases.json
//   npx tsx --env-file=.env sandbox-tests/readback.ts 07F7958...  # one authorization
//
// Needs PAYPAL_ENV=sandbox, PAYPAL_CLIENT_ID, PAYPAL_SECRET and SELLER_D_PAYPAL_EMAIL (the payee).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/lib/paypal/client";

const BASE = "https://api-m.sandbox.paypal.com";
const HOLD_DAYS = 29;

type Money = { currency_code: string; value: string };
type Payee = { email_address?: string; merchant_id?: string };
type Authorization = {
  id: string;
  status: string;
  amount: Money;
  payee?: Payee;
  create_time: string;
  expiration_time: string;
  supplementary_data: { related_ids: { order_id: string } };
};
type Capture = {
  id: string;
  status: string;
  amount: Money;
  final_capture: boolean;
  seller_receivable_breakdown?: { gross_amount: Money; paypal_fee?: Money; platform_fees?: { amount: Money }[] };
  supplementary_data?: { related_ids?: { authorization_id?: string } };
};
type Order = {
  id: string;
  intent: string;
  status: string;
  purchase_units: { payee?: Payee; payments?: { authorizations?: Authorization[]; captures?: Capture[] } }[];
};
type Case = { authorization: string; label: string };

const cents = (m: Money) => Math.round(Number(m.value) * 100);
const eur = (c: number) => `€${(c / 100).toLocaleString("en", { minimumFractionDigits: 2 })}`;

async function main() {
  const config = loadConfig(); // refuses anything but PAYPAL_ENV=sandbox
  const payee = process.env.SELLER_D_PAYPAL_EMAIL?.trim().toLowerCase();
  if (!payee) throw new Error("Set SELLER_D_PAYPAL_EMAIL to the seller's sandbox account, the payee to check against.");

  const basic = Buffer.from(`${config.clientId}:${config.secret}`).toString("base64");
  const tokenRes = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!tokenRes.ok) throw new Error(`PayPal refused the client credentials (${tokenRes.status}).`);
  const token = ((await tokenRes.json()) as { access_token: string }).access_token;

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`GET ${path}: PayPal answered ${res.status}`);
    return (await res.json()) as T;
  }

  const fromArgs = process.argv.slice(2).map((authorization) => ({ authorization, label: "from the command line" }));
  const cases: Case[] = fromArgs.length
    ? fromArgs
    : (JSON.parse(readFileSync(join(__dirname, "cases.json"), "utf8")) as { cases: Case[] }).cases;

  let failed = 0;
  for (const c of cases) {
    const checks: [string, boolean, string][] = [];
    const check = (name: string, ok: boolean, detail: string) => checks.push([name, ok, detail]);

    const auth = await get<Authorization>(`/v2/payments/authorizations/${encodeURIComponent(c.authorization)}`);
    const order = await get<Order>(`/v2/checkout/orders/${encodeURIComponent(auth.supplementary_data.related_ids.order_id)}`);
    const unit = order.purchase_units[0];
    // An order holds every capture taken against its authorizations; keep this hold's own.
    const captures = (unit.payments?.captures ?? []).filter(
      (k) => !k.supplementary_data?.related_ids?.authorization_id || k.supplementary_data.related_ids.authorization_id === auth.id,
    );
    const held = cents(auth.amount);
    const paid = captures.filter((k) => k.status === "COMPLETED").reduce((s, k) => s + cents(k.amount), 0);
    const final = captures.some((k) => k.final_capture && k.status === "COMPLETED");
    const days = (Date.parse(auth.expiration_time) - Date.parse(auth.create_time)) / 86_400_000;

    check("hold, not a sale", order.intent === "AUTHORIZE", `order ${order.id} intent ${order.intent}`);
    check(
      "seller is the payee",
      unit.payee?.email_address?.toLowerCase() === payee && auth.payee?.email_address?.toLowerCase() === payee,
      `order payee ${unit.payee?.email_address}, hold payee ${auth.payee?.email_address}`,
    );
    check("hold lasts 29 days", Math.abs(days - HOLD_DAYS) < 0.01, `created ${auth.create_time}, expires ${auth.expiration_time}`);
    check("never pays more than held", paid <= held, `held ${eur(held)}, paid ${eur(paid)} in ${captures.length} payment(s)`);
    const fees = captures.flatMap((k) => k.seller_receivable_breakdown?.platform_fees ?? []);
    check("no platform fee", fees.length === 0, fees.length ? `platform fees on ${fees.length} payment(s)` : "no platform_fees on any payment");
    if (final) {
      check("final payment closes the hold", auth.status === "CAPTURED", `hold status ${auth.status}, ${eur(held - paid)} never charged`);
    } else {
      const expected = paid > 0 ? "PARTIALLY_CAPTURED" : "CREATED";
      const lapsed = Date.now() > Date.parse(auth.expiration_time);
      check(
        "open hold in the right state",
        auth.status === expected || (lapsed && ["EXPIRED", "VOIDED"].includes(auth.status)),
        `hold status ${auth.status}, ${eur(held - paid)} still held`,
      );
    }

    console.log(`\n${auth.id}  ${c.label}`);
    for (const [name, ok, detail] of checks) {
      if (!ok) failed++;
      console.log(`  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(32)} ${detail}`);
    }
    for (const k of captures) {
      const fee = k.seller_receivable_breakdown?.paypal_fee;
      console.log(`        payment ${k.id}  ${eur(cents(k.amount))}  ${k.status}${k.final_capture ? ", final" : ""}${fee ? `  (PayPal's own fee ${eur(cents(fee))})` : ""}`);
    }
  }

  console.log(failed ? `\n${failed} check(s) failed.` : `\nAll checks passed on ${cases.length} hold(s).`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
