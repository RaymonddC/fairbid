// Four scripted seller agents. Each is a real MCP client that signs in with its own
// key and uses only the public seller tools at /api/mcp, the same way any seller's
// own agent could. They price from a fixed rule, not an LLM, so the demo is repeatable.
//
// Two of them, the Vietnamese traders, share a price rule with a tiny offset and send
// the same product text: the coordination FairBid's collusion screen is built to catch.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DEMO_PHOTOS } from "../../../prisma/demo-photos";

export interface Persona {
  sellerId: string;
  name: string;
  /** Goods price as a share of the buyer's budget. */
  priceShare: number;
  /** Shipping and fees as a share of the goods price. */
  shippingShare: number;
  feesShare: number;
  /** Days to deliver, as a share of the buyer's window. */
  leadShare: number;
  notes: (item: string) => string;
  reply: string;
}

export const PERSONAS: Persona[] = [
  {
    sellerId: "seller-a",
    name: "Large exporter",
    priceShare: 0.75,
    shippingShare: 0.187,
    feesShare: 0.049,
    leadShare: 0.86,
    notes: (item) => `Stamped ${item.toLowerCase()}, factory made. Duties may apply.`,
    reply: "The base pattern is machine-printed; the edges are finished by hand in our factory.",
  },
  {
    sellerId: "seller-b",
    name: "Trader B",
    priceShare: 0.8,
    shippingShare: 0.125,
    feesShare: 0.0375,
    leadShare: 0.75,
    notes: (item) => `${item} in batik style, carton packed, sea and road freight.`,
    reply: "Our partner workshop makes them by hand.",
  },
  {
    sellerId: "seller-c",
    name: "Trader C",
    // Trader B's rule plus 0.4%: close enough to look like one quote.
    priceShare: 0.8032,
    shippingShare: 0.1245,
    feesShare: 0.0373,
    leadShare: 0.75,
    notes: (item) => `${item} in batik style, carton packed, sea and road freight.`,
    reply: "Our partner workshop makes them by hand.",
  },
  {
    sellerId: "seller-d",
    name: "Sari",
    priceShare: 0.763,
    shippingShare: 0.109,
    feesShare: 0.028,
    leadShare: 0.75,
    notes: (item) => `Hand-stamped ${item.toLowerCase()} by six named artisans in Yogyakarta, wax-resist batik.`,
    reply: "Yes. Each piece is stamped by hand with wax (cap batik) in my Yogyakarta workshop; I can send a sample first.",
  },
];

export interface BotStep {
  seller: string;
  tenderId: string;
  action: "bid" | "skip" | "answer" | "error";
  detail: string;
}

type ToolText = { content?: { type: string; text?: string }[]; isError?: boolean };

async function call<T>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as ToolText;
  const text = res.content?.find((c) => c.type === "text")?.text ?? "";
  if (res.isError) throw new Error(text || `${name} failed`);
  return JSON.parse(text) as T;
}

interface OpenTender {
  tender_id: string;
  item?: string;
  quantity?: number;
  budget: number;
  delivery_days?: number;
  i_have_bid: boolean;
}

/** Runs one seller's agent once: bids on open tenders it has not bid on, and answers waiting questions. */
export async function runBot(mcpUrl: string, key: string, p: Persona, only?: string): Promise<BotStep[]> {
  const steps: BotStep[] = [];
  const client = new Client({ name: `fairbid-bot-${p.sellerId}`, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${key}` } } });
  await client.connect(transport);
  try {
    const open = (await call<OpenTender[]>(client, "list_open_tenders")).filter((t) => !only || t.tender_id === only);
    for (const t of open) {
      if (t.i_have_bid) {
        steps.push({ seller: p.name, tenderId: t.tender_id, action: "skip", detail: "already bid" });
        continue;
      }
      const goods = Math.max(1, Math.round(t.budget * p.priceShare));
      const item = t.item ?? "goods";
      try {
        await call(client, "submit_bid", {
          tender_id: t.tender_id,
          goods,
          shipping: Math.round(goods * p.shippingShare),
          fees: Math.round(goods * p.feesShare),
          lead_time_days: Math.max(1, Math.round((t.delivery_days ?? 28) * p.leadShare)),
          hs_code: "6302.51",
          notes: p.notes(item),
          photos: DEMO_PHOTOS[p.sellerId]?.slice(0, 1) ?? [],
        });
        steps.push({ seller: p.name, tenderId: t.tender_id, action: "bid", detail: `${goods} goods` });
      } catch (e) {
        steps.push({ seller: p.name, tenderId: t.tender_id, action: "error", detail: (e as Error).message });
      }
    }

    // Questions arrive after close, so a named tender is checked even when it is no longer open.
    const ids = only ? [only] : open.map((t) => t.tender_id);
    for (const id of ids) {
      const status = await call<{ questions_waiting: { clarification_id: string }[] }>(client, "get_my_bid_status", { tender_id: id }).catch(() => null);
      for (const q of status?.questions_waiting ?? []) {
        await call(client, "answer_clarification", { clarification_id: q.clarification_id, body: p.reply });
        steps.push({ seller: p.name, tenderId: id, action: "answer", detail: q.clarification_id });
      }
    }
  } finally {
    await client.close().catch(() => undefined);
  }
  return steps;
}

/** Runs every bot that has a key, one after another in a fixed order. Bid letters follow
 * submission order, so the exporter is always A, the traders B and C, and Sari D, as on the demo tender. */
export async function runBots(mcpUrl: string, keysBySeller: Map<string, string>, only?: string): Promise<BotStep[]> {
  const steps: BotStep[] = [];
  for (const p of PERSONAS.filter((x) => keysBySeller.has(x.sellerId))) {
    steps.push(
      ...(await runBot(mcpUrl, keysBySeller.get(p.sellerId)!, p, only).catch(
        (e): BotStep[] => [{ seller: p.name, tenderId: only ?? "-", action: "error", detail: (e as Error).message }],
      )),
    );
  }
  return steps;
}

/** MCP_SELLER_KEYS ("seller-a:key,...") as sellerId -> key. */
export function keysBySellerFromEnv(raw: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of (raw ?? "").split(",")) {
    const i = pair.indexOf(":");
    if (i > 0) out.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return out;
}
