// The one model client every AI role goes through: Gemini on Vertex AI. Server only.
//
// Each role sends a system prompt (src/lib/ai/prompts.ts) and gets JSON back that must
// match a schema. Without GOOGLE_CLOUD_PROJECT, or when both the main and the fallback
// model fail, time out or return something that does not fit the schema, the role
// returns its scripted fixture instead, so the whole flow still runs and a demo never
// stops on the AI.

import { GoogleGenAI, ThinkingLevel, type Part } from "@google/genai";
import { z } from "zod";
import { aiFallbackModel, aiLocation, aiModel, aiProject } from "../ai-config";
import { log } from "../log";

export type AiSource = "model" | "fixture";
export interface AiResult<T> {
  value: T;
  source: AiSource;
}

export const aiEnabled = () => Boolean(aiProject()) && process.env.AI_ENABLED !== "false";

/** Text and images for the user turn, independent of the provider. */
export type UserPart = { text: string } | { image: { mimeType: "image/jpeg" | "image/png" | "image/webp"; data: string } };

export interface RoleCall<S extends z.ZodType> {
  role: string;
  system: string;
  user: string | UserPart[];
  schema: S;
  /** Short judgements need little thinking; keep cost and latency down. */
  effort?: "low" | "medium" | "high";
}

let client: GoogleGenAI | null = null;
// Short timeout: a role runs inside a person's click, and the fallback model gets its turn.
const gemini = () =>
  (client ??= new GoogleGenAI({ vertexai: true, project: aiProject(), location: aiLocation(), httpOptions: { timeout: 15_000 } }));

const toParts = (user: string | UserPart[]): Part[] =>
  (typeof user === "string" ? [{ text: user }] : user).map((p) => ("text" in p ? { text: p.text } : { inlineData: p.image }));

const LEVEL = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH } as const;

async function ask<S extends z.ZodType>(model: string, call: RoleCall<S>): Promise<z.infer<S>> {
  const res = await gemini().models.generateContent({
    model,
    contents: [{ role: "user", parts: toParts(call.user) }],
    config: {
      systemInstruction: call.system,
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(call.schema),
      // Thinking levels exist on Gemini 3 models; older ones take a budget instead and keep their default.
      ...(model.startsWith("gemini-3") ? { thinkingConfig: { thinkingLevel: LEVEL[call.effort ?? "low"] } } : {}),
    },
  });
  const finish = res.candidates?.[0]?.finishReason;
  if (finish && finish !== "STOP") throw new Error(`model stopped: ${finish}`);
  const parsed = call.schema.safeParse(JSON.parse(res.text ?? ""));
  if (!parsed.success) throw new Error(`answer did not fit the schema: ${parsed.error.message.slice(0, 200)}`);
  log.info("ai role answered", {
    role: call.role,
    model,
    inputTokens: res.usageMetadata?.promptTokenCount,
    outputTokens: res.usageMetadata?.candidatesTokenCount,
    thinkingTokens: res.usageMetadata?.thoughtsTokenCount,
  });
  return parsed.data;
}

export async function runRole<S extends z.ZodType>(call: RoleCall<S>, fixture: () => z.infer<S>): Promise<AiResult<z.infer<S>>> {
  if (!aiEnabled()) return { value: fixture(), source: "fixture" };
  for (const model of [...new Set([aiModel(), aiFallbackModel()])]) {
    const started = Date.now();
    try {
      return { value: await ask(model, call), source: "model" };
    } catch (error) {
      log.warn("ai role attempt failed", { role: call.role, model, ms: Date.now() - started, error: (error as Error).message?.slice(0, 300) });
    }
  }
  log.warn("ai role used its fixture", { role: call.role });
  return { value: fixture(), source: "fixture" };
}
