// Which duty rate prices a bid, and whether it was checked. Pure, so the rule is tested.
//
// A checked rate was looked up for the bid's own customs code (6 digits or more) and the
// country the goods are made in, which is what decides duty: the same napkins pay 9.6%
// into Germany from Indonesia and 0% from Vietnam. Anything else is borrowed from a
// broader rule, and the bid is still priced (the demo must always run), with a warning.

import type { TariffInput } from "./landed";

export interface RateRow {
  hsPrefix: string;
  destination: string;
  /** ISO alpha-2 country of origin, or "" for a rule that ignores origin. */
  origin: string;
  dutyPct: number;
  vatPct: number;
  effectiveFrom: Date;
  source: string;
}

export interface Tariff extends TariffInput {
  /** Where the duty rate came from, shown beside it. */
  source: string;
  /** Set when the rate is borrowed from a broader rule: say so wherever the rate shows. */
  warning: string | null;
}

/** Digits needed before a code is specific enough to look up. */
export const MIN_CHECKED_DIGITS = 6;

export const hsDigits = (code: string | null | undefined) => (code ?? "").replace(/\D/g, "");

const regions = new Intl.DisplayNames(["en"], { type: "region" });
export const countryName = (alpha2: string) => {
  try {
    return regions.of(alpha2.toUpperCase()) ?? alpha2;
  } catch {
    return alpha2;
  }
};

const showCode = (digits: string) => digits.replace(/^(\d{4})(\d{2})?(\d{2})?.*$/, (_, a, b, c) => [a, b, c].filter(Boolean).join("."));

/** The rule that prices a bid: a checked rate for its code and origin if there is one,
 * otherwise the longest matching broader rule, otherwise any rule for the destination.
 * `demo` prices on the seeded assumptions only, so the demo tells the same story every
 * time, and says so beside the rate. */
export function pickTariff(
  rows: RateRow[],
  hsCode: string | null,
  origin: string | null,
  destination: string,
  { demo = false }: { demo?: boolean } = {},
): Tariff {
  const digits = hsDigits(hsCode);
  const from = (origin ?? "").toUpperCase();
  const latestLongest = (list: RateRow[]) =>
    [...list].sort((a, b) => b.hsPrefix.length - a.hsPrefix.length || b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
  const usable = demo ? rows.filter((r) => r.origin === "") : rows;
  const matches = usable.filter((r) => r.destination === destination && digits.startsWith(r.hsPrefix));

  const checked = demo ? undefined : latestLongest(matches.filter((r) => from && r.origin === from && r.hsPrefix.length >= MIN_CHECKED_DIGITS));
  const row =
    checked ??
    latestLongest(matches.filter((r) => r.origin === "")) ??
    latestLongest(matches) ??
    latestLongest(usable.filter((r) => r.destination === destination));
  if (!row) throw new Error(`No tariff rule for ${destination}. Run npm run db:seed.`);

  const base = { dutyPct: row.dutyPct, vatPct: row.vatPct, asOf: row.effectiveFrom.toISOString().slice(0, 10), source: row.source };
  if (checked) return { ...base, warning: null };

  const what = digits ? showCode(digits) : "this bid";
  const madeIn = from ? ` made in ${countryName(from)}` : "";
  const borrowed = `${showCode(row.hsPrefix)}${row.origin ? ` from ${countryName(row.origin)}` : ""}`;
  if (demo) {
    return {
      ...base,
      warning: `Demo rate: this demo tender is priced on an assumed ${row.dutyPct}% duty for ${borrowed} (${row.source}), not a rate checked for ${what}${madeIn}. Real tenders use a rate checked for each bid's code and country of origin.`,
    };
  }
  return {
    ...base,
    warning: `Borrowed rate: no checked duty rate yet for ${what}${madeIn} into ${countryName(destination)}, so it uses the ${row.dutyPct}% rate for ${borrowed} (${row.source}). Check it before you rely on this price.`,
  };
}

/** Easyship wants 8 digits (or 10). Codes shorter than 6 digits are too broad to look up. */
export function easyshipCode(hsCode: string | null): string | null {
  const digits = hsDigits(hsCode);
  if (digits.length < MIN_CHECKED_DIGITS) return null;
  if (digits.length >= 10) return digits.slice(0, 10);
  return digits.padEnd(8, "0").slice(0, 8);
}

export interface CheckedRate {
  dutyPct: number;
  /** "fta" when a trade agreement or preference applies, "general" otherwise. */
  rateType: string;
  hsApplied: string;
  /** Extra duties stacked on the base rate, such as US Section 301. */
  extras: string[];
}

interface EasyshipDetail {
  hs_code_applied?: string;
  applied_rate_type?: string;
  base_duty_rate?: number;
  additional_rates?: { description?: string; rate?: number }[];
}

/** The duty rate in an Easyship taxes_and_duties answer, base plus stacked rates, as a
 * percentage. Null when Easyship priced it without a rate (a flat small-parcel duty). */
export function rateFromEasyship(body: unknown): CheckedRate | null {
  const details = (body as { tax_and_duty?: { import_duty_details?: EasyshipDetail[] } })?.tax_and_duty?.import_duty_details;
  const d = Array.isArray(details) ? details[0] : undefined;
  if (!d || typeof d.base_duty_rate !== "number" || !Number.isFinite(d.base_duty_rate)) return null;
  const extras = (d.additional_rates ?? []).filter((x) => typeof x.rate === "number" && Number.isFinite(x.rate));
  const rate = d.base_duty_rate + extras.reduce((s, x) => s + (x.rate as number), 0);
  if (rate < 0 || rate > 9.99) return null;
  return {
    dutyPct: Math.round(rate * 10_000) / 100,
    rateType: d.applied_rate_type ?? "general",
    hsApplied: d.hs_code_applied ?? "",
    extras: extras.map((x) => x.description ?? `${(x.rate as number) * 100}%`),
  };
}

/** How a checked rate is credited, beside the number. */
export function checkedSource(r: CheckedRate, on: Date): string {
  const kind = r.rateType === "fta" ? "preferential rate" : "general rate";
  const extra = r.extras.length ? `, incl. ${r.extras.join("; ")}` : "";
  return `Easyship, ${on.toISOString().slice(0, 10)}, ${kind}${extra}`;
}
