import Link from "next/link";
import { redirect } from "next/navigation";
import { AgentKeys } from "@/components/AgentKeys";
import { OwnAgent } from "@/components/OwnAgent";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/ui";
import { agentActivity } from "@/lib/agents/own-agent";
import { db } from "@/lib/db";
import { listAgentKeys } from "@/lib/mcp/agent-keys";
import { publicBaseUrl } from "@/lib/public-url";
import { getUser } from "@/lib/session";

export const metadata = { title: "Your agent · FairBid" };

// What any agent may and may not do, FairBid's own or the bidder's: the rules in code, said plainly.
const CAN = [
  "Find open tenders that match what you make, and skip the rest.",
  "Ask the tender owner what it needs to know. Every bidder sees the answer, and nobody is told who asked.",
  "Seal a bid from your own prices, through the same checks as the bid form.",
  "Answer the tender owner's questions from what you told it, and leave the rest to you.",
];
const CANNOT = [
  "See anyone else's bid, or any price, before the tender closes.",
  "Change a price by answering a question.",
  "Move money. Only the tender owner approves a PayPal hold and confirms each payment.",
  "Act without a trace: everything it does is in the tender's activity log, marked as an agent.",
];

/** A bidder's agent in one place: what it knows, what it did, its keys, and its rules. */
export default async function AgentPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.role !== "seller" || !user.sellerId) redirect("/ai");

  const [agent, activity, keys, base] = await Promise.all([
    db.seller.findUnique({ where: { id: user.sellerId }, select: { agentBrief: true, agentOn: true } }),
    agentActivity(user.sellerId),
    listAgentKeys(user.sellerId),
    publicBaseUrl(),
  ]);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Your agent"
        description="Tell it what you make and what it costs. It bids on matching tenders, asks the tender owner what it needs, and answers their questions."
      />

      <OwnAgent
        brief={agent?.agentBrief ?? ""}
        on={agent?.agentOn ?? false}
        activity={activity}
        keys={<AgentKeys keys={keys} mcpUrl={`${base}/api/mcp`} bare />}
      />

      <Panel className="grid content-start gap-3">
        <h2 className="text-base">What an agent can and cannot do</h2>
        <div className="grid gap-x-8 border-t border-line pt-3 text-sm sm:grid-cols-2">
          <ul className="grid gap-2">
            {CAN.map((c) => (
              <li key={c}>
                <span className="font-medium text-ok">Can</span> <span className="text-muted">{c.charAt(0).toLowerCase() + c.slice(1)}</span>
              </li>
            ))}
          </ul>
          <ul className="grid gap-2 border-line max-sm:mt-3 max-sm:border-t max-sm:pt-3">
            {CANNOT.map((c) => (
              <li key={c}>
                <span className="font-medium text-flag">Cannot</span> <span className="text-muted">{c.charAt(0).toLowerCase() + c.slice(1)}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-faint">
          The same rules hold for an agent of your own, such as Claude, connected with a key.{" "}
          <Link href="/agents" className="font-medium text-dye underline-offset-4 hover:underline">
            How to connect one
          </Link>
        </p>
      </Panel>
    </div>
  );
}
