// The shared contract: tender states, what moves between them, and the sealed
// rule. Pure, with no database or browser access, so server and client both
// import it and tests need no setup.

export const TENDER_STATUSES = [
  "DRAFT",
  "OPEN",
  "CLOSED",
  "REVIEWING",
  "CLARIFYING",
  "PRICED",
  "SCORED",
  "AWARDED",
  "IN_DELIVERY",
  "COMPLETE",
  "CANCELLED",
] as const;

export type TenderStatus = (typeof TENDER_STATUSES)[number];

// There is deliberately no way out of AWARDED except forward. With the seller
// as payee, the PayPal sandbox refuses void, so a hold can only end in captures
// (DECISIONS.md, "No void").
const TRANSITIONS: Record<TenderStatus, readonly TenderStatus[]> = {
  DRAFT: ["OPEN"],
  OPEN: ["CLOSED"],
  CLOSED: ["REVIEWING"],
  REVIEWING: ["CLARIFYING", "PRICED"],
  CLARIFYING: ["PRICED"],
  PRICED: ["SCORED"],
  SCORED: ["AWARDED", "CANCELLED"],
  AWARDED: ["IN_DELIVERY"],
  IN_DELIVERY: ["COMPLETE"],
  COMPLETE: [],
  CANCELLED: [],
};

export function canTransition(from: TenderStatus, to: TenderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(from: TenderStatus, to: TenderStatus) {
    super(`Tender cannot move from ${from} to ${to}.`);
    this.name = "IllegalTransitionError";
  }
}

export function assertTransition(from: TenderStatus, to: TenderStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

/** While sealed, only the count of bids may leave the server. A seller always
 * sees their own bid; nobody sees another's until the tender closes. */
export function isSealed(status: TenderStatus): boolean {
  return status === "DRAFT" || status === "OPEN";
}

export function canSubmitBid(status: TenderStatus, closesAt: Date, now = new Date()): boolean {
  return status === "OPEN" && now < closesAt;
}

/** A PayPal authorization stays valid for 29 days, so delivery must fit inside it. */
export const MAX_DELIVERY_DAYS = 29;

export type MilestoneInput = { name: string; pct: number };

export const DEFAULT_MILESTONES: readonly MilestoneInput[] = [
  { name: "Production started", pct: 30 },
  { name: "Shipped with tracking", pct: 40 },
  { name: "Delivered and confirmed", pct: 30 },
];

/** Whole-cent amounts per milestone. Rounding lands on the last one, so the sum
 * always equals the hold exactly. */
export function milestoneAmounts(holdCents: number, milestones: readonly MilestoneInput[]): number[] {
  const total = milestones.reduce((sum, m) => sum + m.pct, 0);
  if (total !== 100) throw new Error(`Milestones must sum to 100%, got ${total}%.`);
  let paid = 0;
  return milestones.map((m, i) => {
    if (i === milestones.length - 1) return holdCents - paid;
    const amount = Math.round((holdCents * m.pct) / 100);
    paid += amount;
    return amount;
  });
}
