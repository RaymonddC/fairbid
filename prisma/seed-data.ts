// The demo tender from the deck: 300 handmade batik napkins to Berlin. All data
// is illustrative. Shared by the seed and the Reset demo action.

export const DEMO_TENDER_ID = "00000000-0000-4000-8000-000000000001";

export const DEMO_TENDER = {
  id: DEMO_TENDER_ID,
  title: "300 handmade batik napkins, Berlin",
  needText:
    "I need 300 handmade batik napkins for our four hotels in Germany. Budget is around 3,000 euros before VAT, and we need them within 4 weeks. Real handmade, not printed.",
  spec: { item: "Handmade batik napkins", quantity: 300, deliverTo: "Berlin, DE", deliveryDays: 28 },
  budgetCents: 300_000,
  currency: "EUR",
  destinationCountry: "DE",
  vatReclaimable: true,
};

export const DEMO_CRITERIA = [
  { name: "Delivered cost", weightPct: 40, rubric: "Lowest delivered cost inside budget scores highest." },
  { name: "Handmade proof", weightPct: 25, rubric: "Stated technique, confirmed in clarification." },
  { name: "Lead time", weightPct: 20, rubric: "Inside the 28-day window, earlier scores higher." },
  { name: "Completeness", weightPct: 15, rubric: "All fields filled and customs code confirmed." },
];

export const DEMO_SELLERS = [
  { id: "seller-a", name: "Large exporter", country: "ID", paypalEmail: "seller-a@example.com" },
  { id: "seller-b", name: "Trader B", country: "VN", paypalEmail: "seller-b@example.com" },
  { id: "seller-c", name: "Trader C", country: "VN", paypalEmail: "seller-c@example.com" },
  { id: "seller-d", name: "Sari's workshop", country: "ID", paypalEmail: "seller-d@example.com" },
];

export const DEMO_BIDS = [
  {
    sellerId: "seller-a",
    goodsCents: 225_000,
    shippingCents: 42_000,
    feesCents: 11_000,
    leadTimeDays: 24,
    notes: "Stamped batik cloth napkins, 40 x 40 cm. Duties may apply.",
  },
  {
    sellerId: "seller-b",
    goodsCents: 240_000,
    shippingCents: 30_000,
    feesCents: 9_000,
    leadTimeDays: 21,
    notes: "Batik style cotton napkins, 40 x 40 cm, carton packed, sea and road freight to Berlin.",
  },
  {
    sellerId: "seller-c",
    goodsCents: 241_000,
    shippingCents: 30_000,
    feesCents: 9_000,
    leadTimeDays: 21,
    notes: "Batik style cotton napkins, 40 x 40 cm, carton packed, sea and road freight to Berlin.",
  },
  {
    sellerId: "seller-d",
    goodsCents: 229_000,
    shippingCents: 25_000,
    feesCents: 6_500,
    leadTimeDays: 21,
    notes: "Hand-stamped cotton batik napkins by six artisans in Yogyakarta, 40 x 40 cm.",
  },
];

// Assumed 12% demo rate, as on the deck's comparison slide. Replace with the real
// rate for the confirmed HS code before quoting it as fact.
export const DEMO_TARIFFS = [
  {
    hsPrefix: "6302",
    destination: "DE",
    dutyPct: 12,
    vatPct: 19,
    effectiveFrom: new Date("2026-07-01T00:00:00Z"),
    source: "Demo assumption",
  },
];
