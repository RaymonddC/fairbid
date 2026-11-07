// Landed cost: what a bid really costs once delivered. Pure and in integer
// cents, so the same numbers come out on the server, in the grid and in tests.

export interface TariffInput {
  dutyPct: number;
  vatPct: number;
  /** Date the rule applies from, shown beside every quote. */
  asOf: string;
}

export interface BidCosts {
  goodsCents: number;
  shippingCents: number;
  /** Customs broker, handling and documents, including e-meterai. */
  feesCents: number;
  /** Tariff categories in the parcel, for the small-parcel flat duty. */
  tariffCategories?: number;
}

export interface LandedCost {
  goodsCents: number;
  shippingCents: number;
  dutyCents: number;
  feesCents: number;
  vatCents: number;
  /** Delivered cost when the buyer reclaims import VAT. */
  deliveredReclaimedCents: number;
  /** Delivered cost when the buyer cannot reclaim import VAT. */
  deliveredGrossCents: number;
  asOf: string;
  dutyRule: "percent" | "small_parcel_flat";
}

// EU customs duty on parcels under EUR 150 since 1 Jul 2026: a flat EUR 3 per
// tariff category. It does not apply to a commercial shipment above that value.
export const SMALL_PARCEL_LIMIT_CENTS = 15_000;
export const SMALL_PARCEL_DUTY_CENTS = 300;

const pctOf = (cents: number, pct: number) => Math.round((cents * pct) / 100);

export function landedCost(bid: BidCosts, tariff: TariffInput): LandedCost {
  const small = bid.goodsCents < SMALL_PARCEL_LIMIT_CENTS;
  const dutyCents = small
    ? SMALL_PARCEL_DUTY_CENTS * (bid.tariffCategories ?? 1)
    : pctOf(bid.goodsCents, tariff.dutyPct);

  // Import VAT base is goods + shipping + duty.
  const vatCents = pctOf(bid.goodsCents + bid.shippingCents + dutyCents, tariff.vatPct);
  const deliveredReclaimedCents = bid.goodsCents + bid.shippingCents + dutyCents + bid.feesCents;

  return {
    goodsCents: bid.goodsCents,
    shippingCents: bid.shippingCents,
    dutyCents,
    feesCents: bid.feesCents,
    vatCents,
    deliveredReclaimedCents,
    deliveredGrossCents: deliveredReclaimedCents + vatCents,
    asOf: tariff.asOf,
    dutyRule: small ? "small_parcel_flat" : "percent",
  };
}

export function deliveredCents(landed: LandedCost, vatReclaimable: boolean): number {
  return vatReclaimable ? landed.deliveredReclaimedCents : landed.deliveredGrossCents;
}

export function isOverBudget(landed: LandedCost, budgetCents: number): boolean {
  // The buyer sets the budget excluding VAT, so it compares against the reclaimed figure.
  return landed.deliveredReclaimedCents > budgetCents;
}

/** What PayPal holds for the seller at award. The offer is delivered at place
 * (DAP): the seller is paid for goods and shipping, while EU duty, import VAT and
 * the customs broker's fees are the buyer's border costs (OPEN-QUESTIONS.md,
 * "What does the hold cover?", option A). Delivered cost still includes them,
 * so bids are compared on what the buyer really pays. */
export function holdCents(landed: LandedCost): number {
  return landed.goodsCents + landed.shippingCents;
}
