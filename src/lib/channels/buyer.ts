// The pure parts of the buyer's chat: which side of the app an inbound message belongs to,
// which code table a link code came from, and the words of each update. No database and no
// network here, so the routing is tested on its own. A seller link and a buyer link may be
// the same chat (one phone); they stay independent, and a reply goes to the side that sent
// the message it replies to.

export type InboundRoute = "link" | "how-to-link" | "seller" | "buyer-answer" | "buyer-help";

export interface RouteInput {
  /** The text is a link command with a code. */
  linkCode: boolean;
  /** The text is a bare `/start`, as Telegram sends when the bot is opened without a code. */
  bareStart: boolean;
  sellerLinked: boolean;
  buyerLinked: boolean;
  /** The buyer message this one replies to, if it replies to one of ours sent to the buyer side. */
  repliesToBuyer: { tenderQuestionId: string | null } | null;
}

/** Where an inbound message goes. A seller-only chat routes exactly as before buyers could link. */
export function routeInbound(r: RouteInput): InboundRoute {
  if (r.linkCode) return "link";
  if (r.repliesToBuyer && r.buyerLinked) return r.repliesToBuyer.tenderQuestionId ? "buyer-answer" : "buyer-help";
  if (r.bareStart) return r.buyerLinked && !r.sellerLinked ? "buyer-help" : "how-to-link";
  if (r.sellerLinked) return "seller";
  if (r.buyerLinked) return "buyer-help";
  return "how-to-link";
}

type CodeRow = { kind: string; expiresAt: Date };

/** Which table a code was found in, by its hash, if it is still good for this channel. */
export function pickLinkCode(seller: CodeRow | null, buyer: CodeRow | null, kind: string, now = new Date()): "seller" | "buyer" | null {
  const good = (row: CodeRow | null) => Boolean(row && row.kind === kind && row.expiresAt >= now);
  if (good(seller)) return "seller";
  if (good(buyer)) return "buyer";
  return null;
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

const short = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 3)}...` : s);

/** Only the count leaves a sealed tender: never a price, a seller or a letter. */
export function newBidText(tenderTitle: string, count: number): string {
  const which = count === 1 ? "The first sealed bid" : `A ${ordinal(count)} sealed bid`;
  return `FairBid: ${which} arrived on "${short(tenderTitle, 120)}". Prices stay sealed until you close bidding.`;
}

/** A seller answered the buyer's clarification. Bid letter only, never the bidder's name. */
export function replyText(tenderTitle: string, letter: string, answer: string): string {
  return `FairBid: Bid ${letter} answered your question on "${short(tenderTitle, 120)}":\n\n${short(answer.trim(), 1000)}`;
}

export function sellerQuestionText(tenderTitle: string, question: string): string {
  return [
    `FairBid: A bidder asked about "${short(tenderTitle, 120)}":`,
    "",
    short(question.trim(), 1000),
    "",
    "Reply to this message to answer every bidder. The bidder who asked stays anonymous.",
  ].join("\n");
}

export const BUYER_HELP =
  "This chat gets your FairBid tender updates. To answer a bidder's question, use Reply on the question message itself. Everything else happens in FairBid.";

export interface DeliverDeps {
  send(address: string, text: string, opts: { expectReply: boolean }): Promise<{ externalId: string }>;
  record(externalId: string): Promise<void>;
  warn(message: string, fields: Record<string, unknown>): void;
}

/** Sends one message and records it. Never throws: a chat that is down never blocks anything. */
export async function deliverToBuyer(address: string, text: string, expectReply: boolean, deps: DeliverDeps): Promise<boolean> {
  try {
    const { externalId } = await deps.send(address, text, { expectReply });
    await deps.record(externalId);
    return true;
  } catch (error) {
    deps.warn("tender owner channel send failed", { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}
