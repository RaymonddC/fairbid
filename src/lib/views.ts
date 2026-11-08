// What the screens receive. Plain JSON, built on the server by tender-data.ts,
// so no Prisma types (or sealed fields) reach a client component.

import type { CriterionKind } from "./scoring";
import type { TenderStatus } from "./tender";

export interface Spec {
  item: string;
  quantity: number;
  deliverTo: string;
  deliveryDays: number;
}

export interface CriterionView {
  id: string;
  name: string;
  weightPct: number;
  rubric: string;
  kind: CriterionKind;
}

export interface ScoreView {
  criterionId: string;
  score: number;
  reason: string;
}

/** An opened bid. Never built while the tender is sealed. */
export interface BidView {
  id: string;
  letter: string;
  country: string;
  leadTimeDays: number;
  notes: string;
  hsCode: string | null;
  hsConfidence: number | null;
  photos: string[];
  submittedAt: string;
  goodsCents: number;
  shippingCents: number;
  feesCents: number;
  dutyCents: number;
  vatCents: number;
  /** Delivered cost with import VAT reclaimed. */
  deliveredCents: number;
  deliveredGrossCents: number;
  holdCents: number;
  overBudget: boolean;
  scores: ScoreView[];
  /** Weighted total, once the tender is scored. */
  total: number | null;
  flagged: boolean;
  /** Revealed for the winner only, after the award. */
  sellerName: string | null;
}

export interface ReplyView {
  letter: string;
  body: string;
  at: string;
  channel: string;
}

export interface ClarificationView {
  id: string;
  topic: string;
  question: string;
  sentAt: string;
  sentTo: string[];
  replies: ReplyView[];
  waiting: string[];
}

export interface FlagView {
  letters: string[];
  reason: string;
  evidence: string[];
}

export interface CaptureView {
  paypalCaptureId: string | null;
  amountCents: number;
  final: boolean;
  /** PayPal's: COMPLETED, PENDING, DECLINED, DENIED, FAILED, PARTIALLY_REFUNDED or REFUNDED. */
  status: string;
  /** PayPal's reason while PENDING or DENIED. */
  reason: string | null;
  /** Refunded by the seller from their own PayPal account. */
  refundedCents: number;
}

export interface MilestoneView {
  id: string;
  seq: number;
  name: string;
  pct: number;
  /** Planned amount from the hold; the last one absorbs rounding. */
  plannedCents: number;
  status: "pending" | "confirmed" | "captured";
  /** Which phase's hold pays this step (src/lib/phases.ts). */
  phase: number;
  /** When the step is expected, counted from the award. */
  dueAt: string | null;
  capture: CaptureView | null;
}

/** One PayPal hold. An order over 28 days has one per phase. */
export interface HoldView {
  id: string;
  phase: number;
  seq: number;
  status: string;
  paypalOrderId: string;
  paypalAuthId: string | null;
  expiresAt: string | null;
  amountCents: number;
  /** Captured from it so far. */
  usedCents: number;
  /** Approved, not closed, not past its expiry: it can still pay. */
  live: boolean;
  daysLeft: number | null;
}

/** What the buyer does next on an award. */
export type AwardNext =
  | { kind: "done" }
  | { kind: "pay"; phase: number; milestoneId: string }
  /** Approve a hold first: the next phase's, or a new one for a phase whose hold lapsed. */
  | { kind: "hold"; phase: number; milestoneId: string; amountCents: number; replacing: boolean };

export interface AwardView {
  bidId: string;
  letter: string;
  sellerName: string;
  sellerCountry: string;
  payeeEmail: string;
  holdCents: number;
  deliveredCents: number;
  photos: string[];
  /** The hold that matters now: the live one for the current phase, else the newest approved one. */
  authorization: HoldView | null;
  /** Every hold the buyer approved, oldest first. */
  holds: HoldView[];
  /** Phases the order is paid in: 1 for 28 days of delivery or less. */
  phases: number;
  /** Left on live holds now. */
  heldCents: number;
  /** Planned for phases whose hold is not placed yet. */
  notYetHeldCents: number;
  next: AwardNext;
  /** Set when the buyer ended the order between phases. */
  endedAt: string | null;
  milestones: MilestoneView[];
  /** Taken from the hold by captures PayPal accepted, pending ones included. */
  paidCents: number;
  /** Given back by the seller afterwards, from their own account. */
  refundedCents: number;
  /** Never charged: released by the final capture, or never held when the order was ended early. */
  releasedCents: number;
  complete: boolean;
  /** Whole days until the hold expires, counted when the page was read. */
  holdDaysLeft: number | null;
}

export interface TenderView {
  id: string;
  buyerId: string | null;
  title: string;
  needText: string;
  spec: Spec;
  budgetCents: number;
  currency: string;
  destinationCountry: string;
  vatReclaimable: boolean;
  closesAt: string;
  status: TenderStatus;
  sealed: boolean;
  photos: string[];
  criteria: CriterionView[];
  bidCount: number;
  bids: BidView[];
  clarifications: ClarificationView[];
  flags: FlagView[];
  award: AwardView | null;
  waitingReplies: number;
  /** Lowest quoted price and the delivered cost of that bid, for "saved". */
  savedCents: number | null;
}

export interface SellerTenderView {
  id: string;
  title: string;
  needText: string;
  spec: Spec;
  budgetCents: number;
  currency: string;
  destinationCountry: string;
  closesAt: string;
  status: TenderStatus;
  open: boolean;
  photos: string[];
  criteria: CriterionView[];
  dutyPct: number;
  vatPct: number;
  myBid: {
    goodsCents: number;
    shippingCents: number;
    feesCents: number;
    leadTimeDays: number;
    notes: string;
    hsCode: string | null;
    photos: string[];
    submittedAt: string;
  } | null;
  questions: { id: string; topic: string; question: string; sentAt: string; myReply: string | null }[];
  /** Set when this seller won: what has been paid so far. */
  won: {
    holdCents: number;
    paidCents: number;
    heldCents: number;
    phases: number;
    next: AwardNext;
    complete: boolean;
    endedAt: string | null;
    milestones: MilestoneView[];
  } | null;
}

export interface TenderSummary {
  id: string;
  title: string;
  status: TenderStatus;
  budgetCents: number;
  currency: string;
  closesAt: string;
  bidCount: number;
  deliverBy: string;
  photo: string | null;
  heldCents: number;
  paidCents: number;
  savedCents: number;
  waitingReplies: number;
  winnerName: string | null;
}

/** Steps a buyer goes through. Used by the tabs and the dashboard progress bar. */
export const STAGE_ORDER: TenderStatus[] = [
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
];

export const atLeast = (status: TenderStatus, target: TenderStatus) =>
  status !== "CANCELLED" && STAGE_ORDER.indexOf(status) >= STAGE_ORDER.indexOf(target);

/** Score order, with bids over budget last. Ties go to the lower delivered cost. */
export function rankBids(bids: BidView[]): BidView[] {
  return [...bids].sort(
    (a, b) =>
      Number(a.overBudget) - Number(b.overBudget) || (b.total ?? 0) - (a.total ?? 0) || a.deliveredCents - b.deliveredCents,
  );
}
