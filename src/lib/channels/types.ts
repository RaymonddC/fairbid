// The contract every message channel meets. The in-app inbox is the core path; a
// channel is an optional extra that carries the same question to a seller's chat and
// brings the same reply back through `addReply`. Pure types: no database, no network.

export type MessageChannel = "telegram" | "whatsapp";

/** One message a seller sent to us, after the channel's own format is parsed away. */
export interface InboundMessage {
  kind: MessageChannel;
  /** Where the seller can be reached: a Telegram chat id, or a WhatsApp number in E.164. */
  address: string;
  text: string;
  /** The channel's own id for this message. Used to ignore a delivery we already handled. */
  externalId: string;
  /** The id of the message the seller replied to, when they used the Reply gesture. */
  replyToExternalId?: string;
  /** False when the chat is a group or channel. Only a private chat may be linked. */
  private: boolean;
}

export interface Channel {
  kind: MessageChannel;
  label: string;
  /** True when every setting this channel needs is present. An unconfigured channel is off. */
  configured(): boolean;
  /** Sends text to an address. Resolves with the channel's id for the sent message.
   * `expectReply: false` sends an update that needs no answer (default: the reply box opens). */
  send(address: string, text: string, opts?: { expectReply?: boolean }): Promise<{ externalId: string }>;
  /** Reads the body of a webhook call. Null when it holds no message we act on. */
  parseInbound(payload: unknown): InboundMessage | null;
}

/** Text of a question as a seller sees it in a chat. Plain text: nothing to escape. */
/** `tenderUrl` points the seller at the tender page, where the details and the in-app inbox are. */
export function formatQuestion(tenderTitle: string, question: string, tenderUrl?: string): string {
  const title = tenderTitle.length > 120 ? `${tenderTitle.slice(0, 117)}...` : tenderTitle;
  return [
    `FairBid: a buyer has a question about your bid on "${title}".`,
    "",
    question,
    "",
    "Reply to this message to answer. An answer cannot change your price.",
    ...(tenderUrl ? ["", `See the tender, or answer in FairBid: ${tenderUrl}`] : []),
  ].join("\n");
}

/** A link code, as typed or tapped: `/start CODE` (Telegram's deep link) or `link CODE`. */
export function parseLinkCommand(text: string): string | null {
  const m = /^\s*(?:\/start(?:@\w+)?|link)\s+([A-Za-z0-9]{6,16})\s*$/i.exec(text);
  return m ? m[1].toUpperCase() : null;
}

/** Hides most of an address, for showing on a page that other people may see over a shoulder. */
export function maskAddress(kind: MessageChannel, address: string): string {
  if (kind === "telegram") return "your Telegram chat";
  return address.length > 6 ? `${address.slice(0, 3)}${"•".repeat(address.length - 6)}${address.slice(-3)}` : "your number";
}
