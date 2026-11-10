// Checks a duty rate with Easyship once per customs code, country of origin and
// destination, and keeps it as a TariffRate row. Every failure is quiet: the bid is then
// priced on a borrowed rate, which the screens mark (src/lib/duty.ts).

import { db } from "./db";
import { checkedSource, easyshipCode, hsDigits, MIN_CHECKED_DIGITS, rateFromEasyship, type RateRow } from "./duty";
import { log } from "./log";

const API = () => (process.env.EASYSHIP_API_URL?.trim() || "https://public-api.easyship.com").replace(/\/$/, "");
const TIMEOUT_MS = 8_000;

export const dutyLookupEnabled = () => Boolean(process.env.EASYSHIP_TOKEN?.trim());

// Easyship only ships from some countries (not Indonesia or Vietnam), and its rate depends
// on where the goods are made, not where the parcel leaves from. So the parcel "leaves"
// from a country it covers, and the country of origin goes on the item.
const shipFrom = (destination: string) => (destination === "US" ? "HK" : "US");
// Large enough that no small-parcel rule replaces the percentage.
const CUSTOMS_VALUE = 10_000;

type Outcome = "cached" | "checked" | "skipped" | "failed";

/** The rows that can price bids into a destination, in force now. */
export async function ratesFor(destination: string): Promise<RateRow[]> {
  const rows = await db.tariffRate.findMany({ where: { destination, effectiveFrom: { lte: new Date() } } });
  return rows.map((r) => ({ ...r, dutyPct: Number(r.dutyPct), vatPct: Number(r.vatPct) }));
}

/** Makes sure a checked rate exists for this code, origin and destination. Never throws. */
export async function ensureDutyRate(hsCode: string | null, destination: string, origin: string | null): Promise<Outcome> {
  const code = easyshipCode(hsCode);
  const from = (origin ?? "").toUpperCase();
  const token = process.env.EASYSHIP_TOKEN?.trim();
  if (!code || !/^[A-Z]{2}$/.test(from) || !token) return "skipped";
  const prefix = hsDigits(hsCode).slice(0, 10);
  if (prefix.length < MIN_CHECKED_DIGITS) return "skipped";

  try {
    const have = await db.tariffRate.findFirst({ where: { hsPrefix: prefix, destination, origin: from } });
    if (have) return "cached";
    // VAT is not Easyship's to say here: it comes from the destination's own rule.
    const vatRule = await db.tariffRate.findFirst({ where: { destination, origin: "" }, orderBy: { effectiveFrom: "desc" } });
    if (!vatRule) return "skipped";

    const res = await fetch(`${API()}/2024-09/taxes_and_duties`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        origin_country_alpha2: shipFrom(destination),
        destination_country_alpha2: destination,
        currency: destination === "US" ? "USD" : "EUR",
        insurance_fee: 0,
        shipment_charge: 0,
        items: [{ duty_origin_country_alpha2: from, hs_code: code, customs_value: CUSTOMS_VALUE }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (body as { error?: { code?: string; details?: unknown } })?.error;
      log.warn("Duty rate lookup refused", { status: res.status, code: err?.code, details: err?.details, hsCode: code, origin: from, destination });
      return "failed";
    }
    const rate = rateFromEasyship(body);
    if (!rate) {
      log.warn("Duty rate lookup gave no rate", { hsCode: code, origin: from, destination });
      return "failed";
    }
    const now = new Date();
    await db.tariffRate.create({
      data: { hsPrefix: prefix, destination, origin: from, dutyPct: rate.dutyPct, vatPct: vatRule.vatPct, effectiveFrom: now, source: checkedSource(rate, now) },
    });
    log.info("Duty rate checked", { hsCode: code, origin: from, destination, dutyPct: rate.dutyPct, rateType: rate.rateType });
    return "checked";
  } catch (e) {
    log.warn("Duty rate lookup failed", { hsCode: code, origin: from, destination, error: (e as Error).message });
    return "failed";
  }
}

/** One lookup per distinct code and origin, in parallel. */
export async function ensureDutyRates(destination: string, bids: { hsCode: string | null; origin: string | null }[]) {
  if (!dutyLookupEnabled()) return;
  const seen = new Map<string, { hsCode: string | null; origin: string | null }>();
  for (const b of bids) seen.set(`${hsDigits(b.hsCode)}|${(b.origin ?? "").toUpperCase()}`, b);
  await Promise.all([...seen.values()].map((b) => ensureDutyRate(b.hsCode, destination, b.origin)));
}
