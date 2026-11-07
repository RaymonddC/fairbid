// Builds the PayPal Orders v2 request body. Pure, so the two rules that matter
// are tested directly: the seller is always the payee, and the breakdown always
// adds up to the amount.

export interface OrderItem {
  name: string;
  quantity: number;
  unitAmountCents: number;
}

export interface AuthorizeOrderInput {
  /** Our tender id, echoed back by PayPal on webhooks. */
  referenceId: string;
  description: string;
  currency: string;
  /** The winning seller. FairBid never appears as payee. */
  payeeEmail: string;
  items: readonly OrderItem[];
  shippingCents: number;
  taxCents: number;
  handlingCents: number;
}

/** "2880.50" from 288050. Built from integers, because toFixed on a float can
 * round the wrong way and PayPal rejects totals that are off by a cent. */
export function formatAmount(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Invalid amount in cents: ${cents}.`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function orderTotalCents(input: AuthorizeOrderInput): number {
  const itemTotal = input.items.reduce((sum, item) => sum + item.unitAmountCents * item.quantity, 0);
  return itemTotal + input.shippingCents + input.taxCents + input.handlingCents;
}

export function buildAuthorizeOrder(input: AuthorizeOrderInput) {
  const money = (cents: number) => ({ currency_code: input.currency, value: formatAmount(cents) });
  const itemTotal = input.items.reduce((sum, item) => sum + item.unitAmountCents * item.quantity, 0);
  return {
    intent: "AUTHORIZE",
    purchase_units: [
      {
        reference_id: input.referenceId,
        description: input.description,
        payee: { email_address: input.payeeEmail },
        amount: {
          ...money(orderTotalCents(input)),
          breakdown: {
            item_total: money(itemTotal),
            shipping: money(input.shippingCents),
            tax_total: money(input.taxCents),
            handling: money(input.handlingCents),
          },
        },
        items: input.items.map((item) => ({
          name: item.name,
          quantity: String(item.quantity),
          unit_amount: money(item.unitAmountCents),
        })),
      },
    ],
  };
}
