// The one Claude client every AI role goes through. Server only.
//
// Each role sends a system prompt (src/lib/ai/prompts.ts) and gets JSON back that is
// validated against a schema. Without ANTHROPIC_API_KEY, or when a call fails, times out
// or is declined, the role returns its scripted fixture instead, so the whole flow
// still runs for a judge without a key and a demo never stops on the AI.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { aiModel } from "../ai-config";
import { log } from "../log";

export type AiSource = "claude" | "fixture";
export interface AiResult<T> {
  value: T;
  source: AiSource;
}

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim());

let client: Anthropic | null = null;
// Short timeout and two retries: a role runs inside a person's click.
const claude = () => (client ??= new Anthropic({ timeout: 45_000, maxRetries: 2 }));

export type UserContent = Anthropic.Beta.BetaContentBlockParam[];

export interface RoleCall<S extends z.ZodType> {
  role: string;
  system: string;
  user: string | UserContent;
  schema: S;
  /** Short judgements need little thinking; keep cost and latency down. */
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

export async function runRole<S extends z.ZodType>(call: RoleCall<S>, fixture: () => z.infer<S>): Promise<AiResult<z.infer<S>>> {
  if (!aiEnabled()) return { value: fixture(), source: "fixture" };
  const started = Date.now();
  try {
    const res = await claude().beta.messages.parse({
      model: aiModel(),
      max_tokens: call.maxTokens ?? 8_000,
      // If the model declines for policy reasons, the API retries on its default fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: call.system,
      messages: [{ role: "user", content: call.user }],
      output_config: { effort: call.effort ?? "low", format: betaZodOutputFormat(call.schema) },
    });
    if (res.stop_reason === "refusal" || res.parsed_output == null) {
      log.warn("ai role used its fixture", { role: call.role, stopReason: res.stop_reason });
      return { value: fixture(), source: "fixture" };
    }
    log.info("ai role answered", {
      role: call.role,
      model: res.model,
      ms: Date.now() - started,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    });
    return { value: res.parsed_output as z.infer<S>, source: "claude" };
  } catch (error) {
    log.error("ai role failed, used its fixture", error, { role: call.role, ms: Date.now() - started });
    return { value: fixture(), source: "fixture" };
  }
}
