// Demo accounts. Click-to-enter, with no passwords: judges must reach the flow
// in one step, and everything behind them is seeded data and PayPal sandbox money.

export type Role = "buyer" | "seller";

export interface User {
  id: string;
  name: string;
  role: Role;
  /** Set for sellers: the Seller row this account bids as. */
  sellerId?: string;
  detail: string;
}

export const SESSION_COOKIE = "fairbid_session";

/** The role as people read it: bidders and tender owners. The stored values stay "seller" and "buyer". */
export const roleLabel = (role: string) => (role === "seller" ? "Bidder" : role === "buyer" ? "Tender owner" : role);

export const DEMO_USERS: readonly User[] = [
  { id: "buyer-anna", name: "Anna", role: "buyer", detail: "Purchasing lead, boutique hotel group, Berlin" },
  {
    id: "seller-sari",
    name: "Sari",
    role: "seller",
    sellerId: "seller-d",
    detail: "Batik workshop owner, Yogyakarta",
  },
];
