// The pure parts of the Telegram bot: which command a message is, what a button's data means,
// and the words of each screen. No database and no network, so they are tested on their own.
// Button data is short (Telegram allows 64 bytes): a side, a verb, and a tender id.

import type { Button } from "./types";

export type Command = "start" | "help" | "tenders" | "waiting" | "open" | "bids" | "agent";
const COMMANDS: readonly Command[] = ["start", "help", "tenders", "waiting", "open", "bids", "agent"];

/** A bare command such as `/tenders` or `/tenders@fairbid_official_bot`; null for anything else. */
export function parseCommand(text: string): Command | null {
  const m = /^\s*\/([a-z]+)(?:@\w+)?\s*$/i.exec(text);
  const c = m?.[1].toLowerCase() as Command | undefined;
  return c && COMMANDS.includes(c) ? c : null;
}

/** What a tapped button asks for. `o:` buttons are the tender owner's, `b:` the bidder's. */
export type Tap =
  | { side: "owner"; verb: "questions" | "summary" | "close" | "confirm-close"; tenderId: string }
  | { side: "bidder"; verb: "agent-bid" | "ask"; tenderId: string }
  | { side: "bidder"; verb: "agent-on" | "agent-off" | "agent-run" | "bids" }
  | { side: "none"; verb: "dismiss" };

const OWNER_VERBS = { q: "questions", s: "summary", c: "close", C: "confirm-close" } as const;
const BIDDER_TENDER_VERBS = { r: "agent-bid", a: "ask" } as const;
const BIDDER_VERBS = { on: "agent-on", off: "agent-off", run: "agent-run", bids: "bids" } as const;
const ID = /^[0-9a-f-]{36}$/i;

export const tapData = {
  owner: (verb: keyof typeof OWNER_VERBS, tenderId: string) => `o:${verb}:${tenderId}`,
  bidder: (verb: keyof typeof BIDDER_TENDER_VERBS, tenderId: string) => `b:${verb}:${tenderId}`,
  agent: (verb: keyof typeof BIDDER_VERBS) => `b:${verb}`,
  dismiss: "x",
};

/** Reads a button's data back. Null for anything we did not send, so a forged tap does nothing. */
export function parseTap(data: string): Tap | null {
  if (data === "x") return { side: "none", verb: "dismiss" };
  const [side, verb, id] = data.split(":");
  if (side === "o" && verb in OWNER_VERBS && id && ID.test(id)) return { side: "owner", verb: OWNER_VERBS[verb as keyof typeof OWNER_VERBS], tenderId: id };
  if (side === "b" && verb in BIDDER_TENDER_VERBS && id && ID.test(id))
    return { side: "bidder", verb: BIDDER_TENDER_VERBS[verb as keyof typeof BIDDER_TENDER_VERBS], tenderId: id };
  if (side === "b" && verb in BIDDER_VERBS && id === undefined) return { side: "bidder", verb: BIDDER_VERBS[verb as keyof typeof BIDDER_VERBS] };
  return null;
}

export interface Sides {
  owner: boolean;
  bidder: boolean;
}

/** The commands listed under "/" in a chat, for the sides it is linked to. */
export function commandsFor(sides: Sides): { command: string; description: string }[] {
  return [
    ...(sides.owner
      ? [
          { command: "tenders", description: "Your tenders: questions, summary, close bidding" },
          { command: "waiting", description: "Bidders' questions waiting for you" },
        ]
      : []),
    ...(sides.bidder
      ? [
          { command: "open", description: "Open tenders: let your agent bid, or ask" },
          { command: "bids", description: "Your bids and where they stand" },
          { command: "agent", description: "Your agent: on, off, run now" },
        ]
      : []),
    { command: "help", description: "What this chat can do" },
  ];
}

/** The menu shown on /start and /help. */
export function helpText(sides: Sides): string {
  const lines = ["FairBid. Tap a command, or just write to your agent, for example \"how is my cushion tender going?\"", ""];
  if (sides.owner) {
    lines.push("As a tender owner:", "/tenders  your tenders, with buttons to read questions, get a summary or close bidding", "/waiting  bidders' questions waiting for you; reply to one to answer every bidder", "");
  }
  if (sides.bidder) {
    lines.push("As a bidder:", "/open  open tenders; let your agent bid, or ask the tender owner", "/bids  your bids and where they stand", "/agent  switch your agent on or off, or run it now", "");
  }
  lines.push("Awards and PayPal payments stay in the FairBid website.");
  return lines.join("\n");
}

const short = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 3)}...` : s);

/** How a tender stands, in a few words, as its owner sees it. Before close only the count of bids shows. */
export function ownerStatus(status: string, bids: number): string {
  const n = `${bids} sealed bid${bids === 1 ? "" : "s"}`;
  switch (status) {
    case "OPEN":
      return `Open, ${n}`;
    case "CLOSED":
    case "REVIEWING":
    case "CLARIFYING":
      return `Bidding closed, ${bids} bid${bids === 1 ? "" : "s"}: questions to bidders`;
    case "PRICED":
    case "SCORED":
      return "Ready to compare and award";
    case "AWARDED":
    case "IN_DELIVERY":
      return "Awarded, in delivery";
    case "COMPLETE":
      return "Complete";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status.toLowerCase();
  }
}

/** How a bidder's own bid stands. */
export function bidStatus(status: string, won: boolean | null): string {
  if (status === "OPEN") return "Sealed until bidding closes";
  if (["CLOSED", "REVIEWING", "CLARIFYING", "PRICED", "SCORED"].includes(status)) return "Bidding closed: the tender owner is comparing bids";
  if (status === "CANCELLED") return "The tender was cancelled";
  if (won === true) return status === "COMPLETE" ? "You won, and the order is complete" : "You won this tender";
  if (won === false) return "Another bid was chosen";
  return status.toLowerCase();
}

export interface OwnerTenderCard {
  id: string;
  title: string;
  status: string;
  bids: number;
  closes: string;
  waiting: number;
  answered: number;
}

export function ownerTenderCard(t: OwnerTenderCard, url: string | null): { text: string; buttons: Button[][] } {
  const lines = [short(t.title, 120), `${ownerStatus(t.status, t.bids)}${t.status === "OPEN" ? `, closes ${t.closes}` : ""}`];
  if (t.waiting) lines.push(`${t.waiting} question${t.waiting === 1 ? "" : "s"} waiting for you`);
  else if (t.answered) lines.push(`${t.answered} question${t.answered === 1 ? "" : "s"} answered, none waiting`);
  const open = t.status === "OPEN";
  const buttons: Button[][] = [
    [
      { text: t.waiting ? `Answer questions (${t.waiting})` : "Questions", data: tapData.owner("q", t.id) },
      { text: "Summary", data: tapData.owner("s", t.id) },
    ],
    [...(open ? [{ text: "Close bidding", data: tapData.owner("c", t.id) }] : []), ...(url ? [{ text: "Open in FairBid", url }] : [])],
  ];
  return { text: lines.join("\n"), buttons };
}

export interface OpenTenderCard {
  id: string;
  title: string;
  quantity: number;
  item: string;
  destination: string;
  budget: string;
  closes: string;
  youBid: boolean;
  answers: number;
}

export function openTenderCard(t: OpenTenderCard, url: string | null): { text: string; buttons: Button[][] } {
  const lines = [
    short(t.title, 120),
    `${t.quantity} x ${short(t.item, 60)}, to ${t.destination}. Budget ${t.budget}. Closes ${t.closes}.`,
    t.youBid ? "You have a sealed bid on it." : t.answers ? `${t.answers} question${t.answers === 1 ? "" : "s"} answered for every bidder.` : "",
  ].filter(Boolean);
  const buttons: Button[][] = [
    [...(t.youBid ? [] : [{ text: "Let my agent bid", data: tapData.bidder("r", t.id) }]), { text: "Ask a question", data: tapData.bidder("a", t.id) }],
    ...(url ? [[{ text: "Open in FairBid", url }]] : []),
  ];
  return { text: lines.join("\n"), buttons };
}

export const askPrompt = (title: string) =>
  `Type your question about "${short(title, 120)}" as a reply to this message.\n\nThe tender owner's AI answers at once when the tender settles it; the rest goes to the tender owner. Every bidder sees the answer, and nobody is told who asked.`;
