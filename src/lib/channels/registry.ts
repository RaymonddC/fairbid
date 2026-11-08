import { telegramChannel } from "./telegram";
import type { Channel, MessageChannel } from "./types";
import { whatsappChannel } from "./whatsapp";

export const CHANNELS: Record<MessageChannel, Channel> = { telegram: telegramChannel, whatsapp: whatsappChannel };

export function isMessageChannel(kind: unknown): kind is MessageChannel {
  return kind === "telegram" || kind === "whatsapp";
}
