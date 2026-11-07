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
  status: string;
}

export interface MilestoneView {
  id: string;
  seq: number;
  name: string;
  pct: number;
  /** Planned amount from the hold; the last one absorbs rounding. */
  plannedCents: number;
  status: "pending" | "confirmed" | "captured";
  capture: CaptureView | null;
}

export interface AwardView {
  bidId: string;
  letter: string;
  sellerName: string;
  sellerCountry: string;
  payeeEmail: string;
  holdCents: number;
  deliveredCents: number;
  photos: string[];
  authorization: { status: string; paypalOrderId: string; paypalAuthId: string | null; expiresAt: string | null; amountCents: number } | null;
  milestones: MilestoneView[];
  paidCents: number;
  /** Released back to the buyer by the final capture. */
  releasedCents: number;
  complete: boolean;
  /** Whole days until the hold expires, counted when the page was read. */
  holdDaysLeft: number | null;
}

export interface TenderView {
  id: string;
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
  won: { holdCents: number; paidCents: number; milestones: MilestoneView[] } | null;
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
