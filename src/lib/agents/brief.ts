// The pure half of FairBid's own seller agent: reading a seller's brief ("what do you
// make and sell?") and, without the AI, deciding whether a tender fits it and what to bid.
// Nothing here touches the database or the network, so it is tested directly.
// Money is integer cents.

export interface BriefTender {
  title: string;
  needText: string;
  item: string;
  quantity: number;
  /** The buyer's delivery window in days. */
  deliveryDays: number;
}

export interface BriefFacts {
  /** Price of one piece, in cents, when the brief says it ("€7.50 each"). */
  unitCents: number | null;
  /** Shipping for the whole order, in cents, when the brief says it. */
  shippingCents: number | null;
  /** Broker, document or other fees, in cents, when the brief says them. */
  feesCents: number | null;
  /** Days to deliver, when the brief says it ("in about 3 weeks"). */
  leadDays: number | null;
}

export type AgentPlan =
  | {
      kind: "bid";
      goodsCents: number;
      shippingCents: number;
      feesCents: number;
      leadTimeDays: number;
      notes: string;
    }
  | { kind: "skip"; reason: string };

export const MAX_BRIEF = 2000;

const MONEY = String.raw`(?:€|eur(?:os?)?\s*|\$|usd\s*|us\$)?\s*(\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:€|eur(?:os?)?|\$|usd|dollars?)?`;

/** "7.50", "7,50", "1,250", "1.250,00" to cents. A comma or dot followed by exactly two digits at the end is decimals. */
export function toCents(raw: string): number | null {
  const s = raw.replace(/\s/g, "");
  const m = /^(.*?)(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = m[1].replace(/[.,]/g, "");
  if (!/^\d+$/.test(whole)) return null;
  const frac = (m[2] ?? "").padEnd(2, "0");
  const cents = Number(whole) * 100 + Number(frac || 0);
  return Number.isSafeInteger(cents) ? cents : null;
}

function firstMoney(text: string, pattern: RegExp): number | null {
  const m = pattern.exec(text);
  if (!m) return null;
  const raw = m.slice(1).find((g) => g !== undefined && /\d/.test(g));
  return raw ? toCents(raw) : null;
}

/** Reads the prices, shipping, fees and lead time a seller wrote in their own words. */
export function parseBrief(brief: string): BriefFacts {
  const t = brief.toLowerCase().replace(/ /g, " ");
  const unitCents =
    firstMoney(t, new RegExp(`${MONEY}\\s*(?:each|apiece|a piece|per (?:piece|pc|unit|item|one|set|pair)|/\\s*(?:piece|pc|pcs|unit|item))`, "i")) ??
    firstMoney(t, new RegExp(`(?:each|per (?:piece|pc|unit|item))\\s*(?:at|for|costs?|is)?\\s*${MONEY}`, "i"));
  const shippingCents = firstMoney(
    t,
    new RegExp(`(?:shipping|freight|delivery|postage|courier)[^.€$\\d]{0,40}?${MONEY}`, "i"),
  ) ?? firstMoney(t, new RegExp(`${MONEY}\\s*(?:for |in )?(?:shipping|freight|postage)`, "i"));
  const feesCents =
    firstMoney(t, new RegExp(`(?:broker(?:age)?|customs (?:fees?|paperwork|documents?)|documents?|paperwork|fees?)[^.€$\\d]{0,40}?${MONEY}`, "i")) ??
    firstMoney(t, new RegExp(`${MONEY}\\s*(?:in |of |for )?(?:broker(?:age)?|document|paperwork)?\\s*fees?`, "i"));
  return { unitCents, shippingCents, feesCents, leadDays: parseLeadDays(t) };
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** "about 3 weeks", "in 10 days", "two months". The first one found. */
export function parseLeadDays(text: string): number | null {
  const m = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:-\s*\d{1,3}\s*)?(day|week|month)s?\b/i.exec(text);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()];
  const per = { day: 1, week: 7, month: 30 }[m[2].toLowerCase() as "day" | "week" | "month"];
  const days = n * per;
  return days >= 1 && days <= 365 ? days : null;
}

const STOP = new Set(
  "a an and are as at be by for from handmade hand made in is it of on or our per piece pieces set sets the to we with you your about around each ship ships shipping cm mm x pcs item items unit units new good high quality".split(
    " ",
  ),
);

/** Lowercase content words, crude singulars, no numbers. */
export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-zà-ÿ]+/g) ?? [])
    .map((w) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Whether the brief names what the tender buys: its head noun, or two of its words. */
export function matchesBrief(brief: string, tender: Pick<BriefTender, "item" | "title">): { match: boolean; shared: string[] } {
  const have = new Set(words(brief));
  const item = words(tender.item);
  const wanted = item.length ? item : words(tender.title);
  const shared = [...new Set(wanted.filter((w) => have.has(w)))];
  const head = wanted[wanted.length - 1];
  return { match: (head !== undefined && have.has(head)) || shared.length >= 2, shared };
}

/** The seller's product line for the bid: the brief's first sentence, in their words. */
export function briefNotes(brief: string): string {
  const first = brief.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  return first.slice(0, 500);
}

/** Default shipping when the brief gives none: a tenth of the goods, so delivered cost is never understated. */
export const DEFAULT_SHIPPING_SHARE = 0.1;
/** Default days to deliver when the brief gives none: three weeks, or the buyer's window if shorter. */
export const DEFAULT_LEAD_DAYS = 21;

/** The deterministic agent: used when the AI is off or fails. Bids honestly from the brief or says why not. */
export function planFromBrief(brief: string, tender: BriefTender): AgentPlan {
  const text = brief.trim();
  if (!text) return { kind: "skip", reason: "Your description is empty." };
  const { match } = matchesBrief(text, tender);
  if (!match) return { kind: "skip", reason: `Not something you make: your description does not mention ${tender.item.toLowerCase() || "this item"}.` };
  const facts = parseBrief(text);
  if (facts.unitCents === null || facts.unitCents <= 0) {
    return { kind: "skip", reason: "Your description gives no price per piece, for example \"€7.50 each\"." };
  }
  const quantity = Math.max(1, Math.round(tender.quantity));
  const goodsCents = facts.unitCents * quantity;
  const window = Math.max(1, Math.round(tender.deliveryDays));
  const leadTimeDays = facts.leadDays ?? Math.min(DEFAULT_LEAD_DAYS, window);
  if (leadTimeDays > window) {
    return { kind: "skip", reason: `You need about ${leadTimeDays} days; the buyer wants delivery within ${window}.` };
  }
  return {
    kind: "bid",
    goodsCents,
    shippingCents: facts.shippingCents ?? Math.round(goodsCents * DEFAULT_SHIPPING_SHARE),
    feesCents: facts.feesCents ?? 0,
    leadTimeDays,
    notes: briefNotes(text),
  };
}

/** The deterministic answer to a buyer's question: the brief's sentence that covers it, or null to leave it for the seller. */
export function answerFromBrief(brief: string, question: string): string | null {
  // The price is locked once bidding closes: a question about it is for the seller, never the agent.
  if (/\b(price|discount|cheaper|lower|cost)\b/i.test(question)) return null;
  const asked = new Set(words(question));
  if (asked.size === 0) return null;
  let best: { sentence: string; hits: number } | null = null;
  for (const sentence of brief.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)) {
    const hits = new Set(words(sentence).filter((w) => asked.has(w))).size;
    if (!best || hits > best.hits) best = { sentence, hits };
  }
  if (!best || best.hits < 2) return null;
  return best.sentence.slice(0, 1000);
}
