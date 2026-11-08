// The MCP server seller agents talk to. One server per request (stateless), bound to
// the seller whose key signed the request, so a tool can only ever see that seller's
// own bid. Every tool calls the same functions the seller screens use (workflow.ts),
// so a bid from an agent follows exactly the rules a bid from the form does.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "../db";
import { getSellerTenderView } from "../tender-data";
import { StepError, addReply, submitBid, toResult } from "../workflow";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 1) }] });

/** Business-rule failures go back to the agent as a readable tool error, not a crash. */
async function guarded(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    const r = toResult(error);
    return { content: [{ type: "text", text: r.error }], isError: true };
  }
}

/** Money in the tender's currency as an agent reads it: whole units, not cents. */
const units = (cents: number) => Math.round(cents) / 100;

export function buildSellerServer(sellerId: string): McpServer {
  const server = new McpServer({ name: "fairbid-sellers", version: "1.0.0" });
  const actor = `agent:${sellerId}`;

  server.registerTool(
    "list_open_tenders",
    {
      title: "List open tenders",
      description: "Tenders accepting sealed bids now, with what is bought, the budget, the delivery window and the closing time.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      guarded(async () => {
        const open = await db.tender.findMany({
          where: { status: "OPEN", closesAt: { gt: new Date() } },
          orderBy: { closesAt: "asc" },
          include: { criteria: { orderBy: { weightPct: "desc" } }, bids: { where: { sellerId }, select: { id: true } } },
        });
        return open.map((t) => {
          const spec = (t.spec ?? {}) as { item?: string; quantity?: number; deliverTo?: string; deliveryDays?: number };
          return {
            tender_id: t.id,
            title: t.title,
            item: spec.item,
            quantity: spec.quantity,
            deliver_to: spec.deliverTo,
            delivery_days: spec.deliveryDays,
            budget: units(t.budgetCents),
            currency: t.currency,
            closes_at: t.closesAt.toISOString(),
            criteria: t.criteria.map((c) => `${c.name} ${c.weightPct}%`),
            i_have_bid: t.bids.length > 0,
          };
        });
      }),
  );

  server.registerTool(
    "get_tender",
    {
      title: "Read a tender",
      description:
        "The full tender: the buyer's need, the scoring criteria with their rubrics, duty and VAT rates, your own sealed bid if any, and questions the buyer sent you. Other sellers' bids are never shown.",
      inputSchema: { tender_id: z.string().describe("From list_open_tenders") },
      annotations: { readOnlyHint: true },
    },
    ({ tender_id }) =>
      guarded(async () => {
        const v = await getSellerTenderView(tender_id, sellerId);
        if (!v) throw new StepError("Tender not found.");
        return {
          tender_id: v.id,
          title: v.title,
          need: v.needText,
          spec: v.spec,
          budget: units(v.budgetCents),
          currency: v.currency,
          destination_country: v.destinationCountry,
          status: v.status,
          accepting_bids: v.open,
          closes_at: v.closesAt,
          criteria: v.criteria.map((c) => ({ name: c.name, weight_pct: c.weightPct, rubric: c.rubric })),
          duty_pct: v.dutyPct,
          vat_pct: v.vatPct,
          reference_photo_count: v.photos.length,
          my_bid: v.myBid && {
            goods: units(v.myBid.goodsCents),
            shipping: units(v.myBid.shippingCents),
            fees: units(v.myBid.feesCents),
            lead_time_days: v.myBid.leadTimeDays,
            hs_code: v.myBid.hsCode,
            notes: v.myBid.notes,
            submitted_at: v.myBid.submittedAt,
          },
          questions: v.questions.map((q) => ({ clarification_id: q.id, question: q.question, my_reply: q.myReply })),
        };
      }),
  );

  server.registerTool(
    "submit_bid",
    {
      title: "Submit a sealed bid",
      description:
        "Seals your bid on an open tender, or replaces your earlier bid while bidding is open. Amounts are whole units of the tender's currency. Nobody, the buyer included, sees it before the tender closes. Buyers compare bids at delivered cost, so quote shipping and fees honestly.",
      inputSchema: {
        tender_id: z.string(),
        goods: z.number().int().positive().describe("Price for the whole quantity, before shipping"),
        shipping: z.number().int().min(0).describe("Shipping to the delivery address"),
        fees: z.number().int().min(0).describe("Any other fees, for example customs brokerage"),
        lead_time_days: z.number().int().min(1).max(365),
        hs_code: z.string().describe('Customs code, for example "6302.51"'),
        notes: z.string().max(500).describe("What you sell and how it is made"),
        photos: z.array(z.string()).min(1).max(4).describe("Product photos as image data URLs"),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    (a) =>
      guarded(async () => {
        await submitBid(
          a.tender_id,
          sellerId,
          {
            goodsCents: a.goods * 100,
            shippingCents: a.shipping * 100,
            feesCents: a.fees * 100,
            leadTimeDays: a.lead_time_days,
            hsCode: a.hs_code,
            notes: a.notes,
            photos: a.photos,
          },
          actor,
        );
        return { sealed: true, tender_id: a.tender_id, note: "Sealed. It opens when bidding closes." };
      }),
  );

  server.registerTool(
    "get_my_bid_status",
    {
      title: "My bid's status",
      description: "Where your bid stands: sealed, opened, questions waiting for your answer, and whether you won and what has been paid.",
      inputSchema: { tender_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ tender_id }) =>
      guarded(async () => {
        const v = await getSellerTenderView(tender_id, sellerId);
        if (!v) throw new StepError("Tender not found.");
        return {
          tender_status: v.status,
          has_bid: v.myBid !== null,
          sealed: v.myBid !== null && v.status === "OPEN",
          questions_waiting: v.questions.filter((q) => !q.myReply).map((q) => ({ clarification_id: q.id, question: q.question })),
          won: v.won && { held: units(v.won.holdCents), paid: units(v.won.paidCents), currency: v.currency },
        };
      }),
  );

  server.registerTool(
    "answer_clarification",
    {
      title: "Answer a buyer's question",
      description: "Replies to a question the buyer sent about your bid. An answer can explain, never change your price.",
      inputSchema: { clarification_id: z.string(), body: z.string().min(1).max(1000) },
      annotations: { idempotentHint: true },
    },
    ({ clarification_id, body }) =>
      guarded(async () => {
        const c = await db.clarification.findUnique({ where: { id: clarification_id }, select: { tenderId: true } });
        if (!c) throw new StepError("Question not found.");
        const bid = await db.bid.findUnique({ where: { tenderId_sellerId: { tenderId: c.tenderId, sellerId } }, select: { id: true } });
        if (!bid) throw new StepError("You were not asked this question.");
        await addReply(clarification_id, bid.id, body, actor);
        return { answered: true };
      }),
  );

  return server;
}
