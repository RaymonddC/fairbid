// A first guess at a tender from the buyer's plain words. Pure, so the post form and the
// AI tender writer share it: it is the writer's fallback when there is no API key or a
// call fails. The buyer checks and edits every field before publishing.

export type Draft = {
  title: string;
  item: string;
  quantity: number;
  budget: number;
  deliveryDays: number;
  destination: "DE" | "US";
  /** What the buyer should settle before publishing. Empty from the scripted guess. */
  questions: string[];
};

/** "3,000", "3.000", "3k", "2.5k" become 3000 or 2500. */
function amount(raw: string, suffix?: string) {
  const n = Number(raw.replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", "."));
  return /k/i.test(suffix ?? "") ? n * 1000 : n;
}

/** The delivery window is capped at 28 days: a PayPal hold lasts 29. */
export const MAX_WINDOW_DAYS = 28;

export function draftFrom(need: string): Draft {
  const qty = need.match(/\b(\d{1,6})\s+(?!euros?\b|eur\b|weeks?\b|days?\b)([a-z][a-z\s-]{2,60}?)(?=\s+for\b|\s+to\b|[.,]|$)/i);
  const quantity = Number(qty?.[1] ?? 1);
  const item = (qty?.[2] ?? "items").trim();
  // A budget is a number next to "budget", a currency sign, or a currency word.
  const b =
    need.match(/budget[^\d€$]{0,25}[€$]?\s?(\d[\d.,]*)\s*(k)?/i) ??
    need.match(/[€$]\s?(\d[\d.,]*)\s*(k)?/) ??
    need.match(/(\d[\d.,]*)\s*(k)?\s*(?:euros?|eur|dollars?|usd)\b/i);
  const usd = /\$|\busd\b|dollars?/i.test(need);
  const budget = b ? amount(b[1], b[2]) : 1000;
  const weeks = Number(need.match(/(\d+)\s*weeks?/i)?.[1] ?? 4);
  return {
    title: `${quantity} ${item}`,
    item: item.charAt(0).toUpperCase() + item.slice(1),
    quantity,
    budget: Math.round(budget),
    // Dollars or a US city in the request point to a US delivery; otherwise Germany.
    destination: usd || /\b(new york|usa|united states|us)\b/i.test(need) ? "US" : "DE",
    deliveryDays: Math.min(MAX_WINDOW_DAYS, weeks * 7),
    questions: [],
  };
}

/** Brings any draft, the model's included, inside the limits the server will enforce. */
export function clampDraft(d: Draft): Draft {
  const int = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));
  return {
    title: d.title.trim().slice(0, 120) || "New tender",
    item: d.item.trim().slice(0, 80) || "Items",
    quantity: int(d.quantity, 1, 100_000),
    budget: int(d.budget, 50, 1_000_000),
    deliveryDays: int(d.deliveryDays, 1, MAX_WINDOW_DAYS),
    destination: d.destination === "US" ? "US" : "DE",
    questions: d.questions.map((q) => q.trim()).filter(Boolean).slice(0, 3),
  };
}
