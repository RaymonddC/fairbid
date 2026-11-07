// Display formatting shared by server and client components. Money is integer cents.

/** Money in its own currency, from integer cents. EUR reads "€3,000", USD "$3,000". */
export const money = (cents: number, currency = "EUR", digits = 0) =>
  new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IE", {
    style: "currency",
    currency,
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(cents / 100);

/** A formatter bound to one tender's currency: `const eur = moneyFor(t.currency)`. */
export const moneyFor =
  (currency: string) =>
  (cents: number, digits = 0) =>
    money(cents, currency, digits);

export const eur = (cents: number, digits = 0) => money(cents, "EUR", digits);

/** Where a buyer can ship to in the prototype, and the currency PayPal holds in. */
export const DESTINATIONS = [
  { country: "DE", city: "Berlin", label: "Berlin, Germany", currency: "EUR" },
  { country: "US", city: "New York", label: "New York, United States", currency: "USD" },
] as const;

export const currencyOf = (country: string) => DESTINATIONS.find((d) => d.country === country)?.currency ?? "EUR";

/** "10 Nov 2026" in Berlin time, the buyer's clock. */
export const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Berlin" });

/** "10 Nov, 18:00" in Berlin time. */
export const dayTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });

export const countryName = (code: string) =>
  ({ ID: "Indonesia", VN: "Vietnam", TH: "Thailand", PH: "Philippines", MY: "Malaysia", IN: "India", DE: "Germany", US: "United States" })[code] ?? code;

/** Customs confidence as people read it: 0.94 → "94% sure". */
export const sure = (confidence: number) => `${Math.round(confidence * 100)}% sure`;

/** Countries a seller can register from in the prototype. */
export const SELLER_COUNTRIES = ["ID", "VN", "TH", "PH", "MY", "IN"] as const;
