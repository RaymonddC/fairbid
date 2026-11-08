// Runs the four seller agents against a FairBid MCP endpoint.
//
//   MCP_SELLER_KEYS="seller-a:...,seller-b:..." npm run bots -- --url http://localhost:3000/api/mcp [--tender <id>]
//
// Each agent bids once on every open tender it has not bid on, then answers any
// questions waiting for it. Run it again after the buyer closes bidding to answer.

import { keysBySellerFromEnv, runBots } from "../src/lib/agents/bots";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const url = arg("url") ?? "http://localhost:3000/api/mcp";
const keys = keysBySellerFromEnv(process.env.MCP_SELLER_KEYS);
if (keys.size === 0) {
  console.error("Set MCP_SELLER_KEYS to seller-id:key pairs. See .env.example.");
  process.exit(1);
}

runBots(url, keys, arg("tender")).then((steps) => {
  for (const s of steps) console.log(`${s.seller.padEnd(16)} ${s.action.padEnd(6)} ${s.tenderId}  ${s.detail}`);
  if (steps.some((s) => s.action === "error")) process.exitCode = 1;
});
