// What the demo schedule needs to run the four scripted bidder agents on one tender. Shared by
// the website's actions and the Telegram bot, so a tender closed from a chat behaves the same.

import { answerInCharacter } from "../ai/roles";
import { DEMO_USERS } from "../auth";
import { db } from "../db";
import { keysBySellerFromEnv, PERSONAS, runBot, type AnswerFn } from "./bots";
import type { ScheduleDeps } from "./demo-schedule";

export function demoAgentDeps(tenderId: string, ownerId: string): ScheduleDeps {
  // This same server on its loopback address. Never an address taken from the request:
  // a forged Host header would receive the bidder keys.
  const mcpUrl = `http://127.0.0.1:${process.env.PORT ?? 3000}/api/mcp`;
  return {
    ownerId,
    demoUserIds: DEMO_USERS.map((u) => u.id),
    keys: keysBySellerFromEnv(process.env.MCP_SELLER_KEYS),
    runOne: (sellerId, key) => runBot(mcpUrl, key, PERSONAS.find((p) => p.sellerId === sellerId)!, tenderId, answerAsPersona),
    isOpen: async () => (await db.tender.findUnique({ where: { id: tenderId }, select: { status: true } }))?.status === "OPEN",
  };
}

// One answer per profile and question: traders B and C share a profile, so they send the same sentence.
const answers = new Map<string, Promise<string>>();

/** The tender owner's question answered by Gemini as the persona, from its profile. A seller
 * whose own agent is on answers through that agent instead, from their own description. */
const answerAsPersona: AnswerFn = async (p, question) => {
  const own = await db.seller.findUnique({ where: { id: p.sellerId }, select: { agentOn: true, agentBrief: true } });
  if (own?.agentOn && own.agentBrief?.trim()) return null;
  const key = `${p.profile}\n${question}`;
  if (!answers.has(key)) {
    answers.set(key, answerInCharacter(p.profile, question, p.reply).then((r) => r.value));
    if (answers.size > 200) answers.delete(answers.keys().next().value!);
  }
  return answers.get(key)!;
};
