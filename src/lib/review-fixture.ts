// Scripted answers for the AI review of the demo tender, used until the AI roles
// land (README, "Not built yet"). Only the wording comes from here. Prices, the
// ranking and the collusion pairs are computed in code (src/lib/scoring.ts).

export interface FixtureQuestion {
  topic: string;
  question: string;
  sentTo: string[]; // seller ids
  /** Replies already in when bidding closes. Missing sellers are still waiting. */
  replies: { sellerId: string; body: string; minutesAfter: number }[];
}

export const DEMO_QUESTIONS: FixtureQuestion[] = [
  {
    topic: "Handmade or printed",
    question:
      "The tender asks for real handmade batik, not printed. Are your napkins hand-stamped with wax (cap batik), and which workshop makes them? Your price cannot change.",
    sentTo: ["seller-a", "seller-b", "seller-c"],
    replies: [
      {
        sellerId: "seller-a",
        body: "The base pattern is machine-printed, the edges are finished by hand in our Pekalongan factory.",
        minutesAfter: 42,
      },
    ],
  },
  {
    topic: "Sample before production",
    question: "Can you send one sample napkin to Berlin before production starts? Your price cannot change.",
    sentTo: ["seller-a", "seller-d"],
    replies: [{ sellerId: "seller-a", body: "Yes, by courier within 5 days.", minutesAfter: 55 }],
  },
];

/** What a trader says when the demo simulates a late reply. B and C send the
 * same sentence, which the buyer sees next to the coordination flag. */
export const SIMULATED_REPLY = "Our partner workshop in Pekalongan makes them by hand.";

/** A simulated reply to a question the buyer wrote. */
export const SIMULATED_REPLY_GENERIC = "Yes, we can confirm. Photos and documents are available if you need them.";

/** Scores for criteria the AI judges ("reviewed" kind), per seller. */
export const DEMO_REVIEWED_SCORES: Record<string, { score: number; reason: string }> = {
  "seller-a": { score: 45, reason: "Reply says the pattern is machine-printed; only the edges are hand-finished." },
  "seller-b": { score: 40, reason: "Says “batik style”; the maker is not named." },
  "seller-c": { score: 40, reason: "Says “batik style”; the maker is not named." },
  "seller-d": { score: 95, reason: "Hand-stamped by six named artisans; the photos show wax-resist marks." },
};

/** Any tender other than the demo one when no AI review ran (no API key, or the call failed). */
export const UNREVIEWED = { score: 70, reason: "Scripted score: no AI review ran for this bid." };
