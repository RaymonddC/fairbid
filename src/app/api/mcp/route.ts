// MCP over Streamable HTTP for seller agents. Stateless: each request builds a server
// bound to the seller whose API key signed it, answers in JSON, and is done, so it fits
// Cloud Run's scale-to-zero and needs no session store.

import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { log } from "@/lib/log";
import { parseSellerKeys, sellerForToken } from "@/lib/mcp/keys";
import { buildSellerServer } from "@/lib/mcp/server";
import { createLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const perSeller = createLimiter(120, 60_000);

function error(status: number, code: string, message: string, requestId: string) {
  return Response.json({ error: { code, message, request_id: requestId } }, { status, headers: { "x-request-id": requestId } });
}

async function handle(req: Request): Promise<Response> {
  const requestId = randomUUID();
  const sellerId = sellerForToken(req.headers.get("authorization"), parseSellerKeys(process.env.MCP_SELLER_KEYS));
  if (!sellerId) return error(401, "unauthorized", "Send your seller API key as: Authorization: Bearer <key>.", requestId);
  if (!perSeller.hit(sellerId)) return error(429, "rate_limited", "Too many requests. Slow down to 2 a second.", requestId);

  const server = buildSellerServer(sellerId);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const res = await transport.handleRequest(req);
    res.headers.set("x-request-id", requestId);
    return res;
  } catch (e) {
    log.error("mcp request failed", e, { sellerId, requestId });
    return error(500, "internal", "Something went wrong on our side. Quote this request id.", requestId);
  } finally {
    await server.close().catch(() => undefined);
  }
}

export { handle as GET, handle as POST, handle as DELETE };
