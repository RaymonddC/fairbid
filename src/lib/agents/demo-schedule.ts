// The demo feels alive without buttons: when a demo tender owner publishes, the four
// scripted bidder agents bid one by one over about two minutes, and after bidding closes
// they answer their questions within a minute. Scripted agents are for the demo accounts
// only (DECISIONS.md): a real tender owner's tender never gets a scripted bid.
//
// Everything the schedule touches comes in as a dependency, so the timing and the gate
// are tested without a server, a database or MCP keys.

import { PERSONAS, type BotStep } from "./bots";

/** Rough offsets from publishing, one per agent in persona order (A, B, C, D). */
export const BID_DELAYS_MS = [20_000, 45_000, 75_000, 105_000] as const;
/** Rough offsets from closing, one per agent. */
export const ANSWER_DELAYS_MS = [20_000, 26_000, 33_000, 40_000] as const;
/** Each offset moves by up to this much either way, so arrivals do not look like a metronome. */
export const BID_JITTER_MS = 5_000;
export const ANSWER_JITTER_MS = 3_000;

export interface ScheduleDeps {
  /** The owner's account id comes from the session, never from an argument the browser sent. */
  ownerId: string;
  demoUserIds: readonly string[];
  keys: Map<string, string>;
  /** Runs one bidder agent once against this tender (bots.ts runBot). */
  runOne: (sellerId: string, key: string) => Promise<BotStep[]>;
  /** Bids only go in while this says the tender is still open. */
  isOpen?: () => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: (line: string) => void;
}

export const isDemoOwner = (ownerId: string, demoUserIds: readonly string[]) => demoUserIds.includes(ownerId);

/** Absolute offsets, increasing, each moved by up to ±jitter. Order is kept so bid letters follow persona order. */
export function offsets(base: readonly number[], jitter: number, random: () => number = Math.random): number[] {
  const out: number[] = [];
  for (const b of base) {
    const t = Math.round(b + (random() * 2 - 1) * jitter);
    out.push(Math.max(out.length ? out[out.length - 1] + 1_000 : 0, t));
  }
  return out;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function runSchedule(kind: "bid" | "answer", tenderId: string, base: readonly number[], jitter: number, d: ScheduleDeps): Promise<BotStep[]> {
  const log = d.log ?? ((line: string) => console.log(line));
  if (!isDemoOwner(d.ownerId, d.demoUserIds)) return [];
  const bots = PERSONAS.filter((p) => d.keys.has(p.sellerId));
  if (bots.length === 0) {
    log(`[demo-agents] ${kind}: no bidder agents set up (MCP_SELLER_KEYS is empty), tender ${tenderId} skipped`);
    return [];
  }
  const sleep = d.sleep ?? defaultSleep;
  const at = offsets(base, jitter, d.random);
  const steps: BotStep[] = [];
  let elapsed = 0;
  for (const [i, p] of bots.entries()) {
    const wait = (at[i] ?? at[at.length - 1] + 10_000 * (i - at.length + 1)) - elapsed;
    await sleep(Math.max(0, wait));
    elapsed += Math.max(0, wait);
    try {
      if (kind === "bid" && d.isOpen && !(await d.isOpen())) {
        log(`[demo-agents] bid: tender ${tenderId} is no longer open, ${p.name} and the rest stand down`);
        break;
      }
      const s = await d.runOne(p.sellerId, d.keys.get(p.sellerId)!);
      steps.push(...s);
      log(`[demo-agents] ${kind}: ${p.name} on ${tenderId}: ${s.map((x) => `${x.action} (${x.detail})`).join(", ") || "nothing to do"}`);
    } catch (e) {
      steps.push({ seller: p.name, tenderId, action: "error", detail: (e as Error).message });
      log(`[demo-agents] ${kind}: ${p.name} on ${tenderId} failed: ${(e as Error).message}`);
    }
  }
  return steps;
}

/** After a demo owner publishes: one sealed bid at roughly 20s, 45s, 75s and 105s. */
export const scheduleDemoBids = (tenderId: string, d: ScheduleDeps) => runSchedule("bid", tenderId, BID_DELAYS_MS, BID_JITTER_MS, d);

/** After a demo owner closes bidding: the agents answer their questions within about 20 to 40 seconds. */
export const scheduleDemoAnswers = (tenderId: string, d: ScheduleDeps) =>
  runSchedule("answer", tenderId, ANSWER_DELAYS_MS, ANSWER_JITTER_MS, d);
