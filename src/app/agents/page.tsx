import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Panel, SectionTitle, linkButton } from "@/components/ui";
import { publicBaseUrl } from "@/lib/public-url";
import { getUser } from "@/lib/session";

export const metadata = {
  title: "Connect an AI agent · FairBid",
  description: "Let your own AI agent find tenders, seal bids and answer tender owners' questions on FairBid, through MCP.",
};

const TOOLS: { name: string; does: string; input: string }[] = [
  {
    name: "list_open_tenders",
    does: "Tenders taking bids now: what is bought, how many, where to, the budget, the delivery window, the closing time and the scoring criteria.",
    input: "none",
  },
  {
    name: "get_tender",
    does: "One tender in full: the tender owner's need, each criterion with its rubric, the duty and VAT rates used to compare bids, your own sealed bid if any, and questions sent to you. Other bidders' bids are never shown.",
    input: "tender_id",
  },
  {
    name: "submit_bid",
    does: "Seals your bid, or replaces your earlier one while bidding is open. Nobody, the tender owner included, sees it before the tender closes.",
    input: "tender_id, goods, shipping, fees (whole units of the tender's currency), lead_time_days, hs_code, notes, photos (1 to 4)",
  },
  {
    name: "get_my_bid_status",
    does: "Where your bid stands: sealed or opened, questions waiting for you, whether you won, what has been paid, what PayPal holds now, and whether the next phase is held.",
    input: "tender_id",
  },
  {
    name: "get_debrief",
    does: "If your bid lost, once the award is final: your rank, your score on each criterion against the winning bid's, the points each one cost you, and both delivered costs. Never the winner's name, price lines or product details.",
    input: "tender_id",
  },
  {
    name: "answer_clarification",
    does: "Answers a question the tender owner sent about your bid. An answer can explain; it can never change your price.",
    input: "clarification_id, body (up to 1,000 characters)",
  },
];

export default async function AgentsPage() {
  const [user, base] = await Promise.all([getUser(), publicBaseUrl()]);
  const url = `${base}/api/mcp`;
  const seller = user?.role === "seller";

  const claudeCode = `claude mcp add --transport http fairbid ${url} \\\n  --header "Authorization: Bearer YOUR_KEY"`;
  const desktop = JSON.stringify(
    {
      mcpServers: {
        fairbid: {
          command: "npx",
          args: ["-y", "mcp-remote", url, "--header", "Authorization:${FAIRBID_AUTH}"],
          env: { FAIRBID_AUTH: "Bearer YOUR_KEY" },
        },
      },
    },
    null,
    2,
  );
  const generic = JSON.stringify({ mcpServers: { fairbid: { url, headers: { Authorization: "Bearer YOUR_KEY" } } } }, null, 2);
  const curl = `curl -s ${url} \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

  return (
    <>
      <PageHeader
        title="Connect an AI agent"
        description="Bidders can let their own AI agent work FairBid for them: find open tenders, seal bids, answer tender owners' questions and follow payments. It talks to FairBid over MCP, the open protocol AI assistants use for tools, under exactly the rules the website follows."
        actions={
          seller ? (
            <Link href="/" className={linkButton.primary}>
              Make a key on your dashboard
            </Link>
          ) : (
            <Link href="/register" className={linkButton.primary}>
              Create a bidder account
            </Link>
          )
        }
      />

      <div className="grid gap-8">
        <section className="grid gap-3" aria-labelledby="steps-title">
          <SectionTitle id="steps-title">Three steps</SectionTitle>
          <ol className="grid gap-3 md:grid-cols-3">
            <Step n={1} title="Get a key">
              Sign in as a bidder and press <strong className="font-semibold">Make a key</strong> on your dashboard. Copy it: it is shown once.
              {!user && (
                <>
                  {" "}
                  No account? <Link href="/register" className="font-medium text-dye underline underline-offset-4">Register as a bidder</Link>, or
                  sign in as the demo bidder, Sari, to try it.
                </>
              )}
            </Step>
            <Step n={2} title="Add FairBid to your agent">
              Point any MCP client at the address below and send the key as a bearer token. Setup for common clients follows.
            </Step>
            <Step n={3} title="Ask it">
              For example: &ldquo;List open FairBid tenders I could supply, and draft a bid for the batik one.&rdquo; Check what it proposes before
              it seals a bid.
            </Step>
          </ol>
        </section>

        <Panel className="grid gap-3">
          <h2 className="text-base">Server</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-[160px_minmax(0,1fr)]">
            <dt className="text-muted">Address</dt>
            <dd>
              <code className="break-all font-mono">{url}</code>
            </dd>
            <dt className="text-muted">Transport</dt>
            <dd>Streamable HTTP, stateless; each request is answered as JSON</dd>
            <dt className="text-muted">Authentication</dt>
            <dd>
              <code className="font-mono">Authorization: Bearer &lt;your key&gt;</code>
            </dd>
            <dt className="text-muted">Limit</dt>
            <dd>120 requests a minute per bidder</dd>
          </dl>
        </Panel>

        <section className="grid gap-3" aria-labelledby="setup-title">
          <SectionTitle id="setup-title">Set up your agent</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-2">
            <Snippet title="Claude Code" note="Run once in a terminal. Then ask Claude about FairBid tenders.">
              {claudeCode}
            </Snippet>
            <Snippet
              title="Claude Desktop"
              note="Add to claude_desktop_config.json (Settings, Developer, Edit config) and restart Claude. Needs Node.js; mcp-remote bridges the HTTP server for the desktop app."
            >
              {desktop}
            </Snippet>
            <Snippet title="Other MCP clients" note="Most clients that support remote servers take a URL and headers. The exact key names vary by client; check its docs.">
              {generic}
            </Snippet>
            <Snippet title="Check it by hand" note="Lists the tools your key can use. A 401 means the key is wrong or revoked.">
              {curl}
            </Snippet>
          </div>
        </section>

        <section className="grid gap-3" aria-labelledby="tools-title">
          <SectionTitle id="tools-title">Tools</SectionTitle>
          <Panel className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-3 font-medium">Tool</th>
                  <th className="px-4 py-3 font-medium">What it does</th>
                  <th className="px-4 py-3 font-medium">Input</th>
                </tr>
              </thead>
              <tbody>
                {TOOLS.map((t) => (
                  <tr key={t.name} className="border-b border-line align-top last:border-0">
                    <td className="px-4 py-3">
                      <code className="font-mono text-xs">{t.name}</code>
                    </td>
                    <td className="px-4 py-3">{t.does}</td>
                    <td className="px-4 py-3 text-muted">{t.input}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </section>

        <section className="grid gap-3" aria-labelledby="rules-title">
          <SectionTitle id="rules-title">Rules an agent cannot get around</SectionTitle>
          <ul className="grid gap-2 text-sm md:grid-cols-2">
            <Rule>Every tool calls the same code as the website, so an agent&apos;s bid follows exactly the rules of a bid typed in the form.</Rule>
            <Rule>A key only ever acts as its own bidder. It sees that bidder&apos;s bid and no one else&apos;s.</Rule>
            <Rule>Bids stay sealed until the tender closes, and a bid after the closing time is refused.</Rule>
            <Rule>An answer to a tender owner&apos;s question can explain a bid but never change its price.</Rule>
            <Rule>
              Agents never move money. Only the tender owner approves a PayPal hold, and only the tender owner confirms each payment. An agent can see what has
              been paid.
            </Rule>
            <Rule>Everything an agent does appears in the tender&apos;s activity log, marked as an agent.</Rule>
            <Rule>
              Photos are required, 1 to 4, as image data URLs (JPEG, PNG, WebP or SVG, up to about 450 KB each). An agent on your computer can read
              them from files.
            </Rule>
            <Rule>Revoke a key on your dashboard and it stops working at once. FairBid stores only a fingerprint of each key.</Rule>
          </ul>
        </section>

        <p className="text-xs text-faint">
          FairBid runs on PayPal&apos;s sandbox: no real money moves. The demo bidder account, Sari, is shared by every visitor, so keys made on
          it are visible to others and the oldest gives way after five. Register your own bidder account to keep your keys to yourself.
        </p>
      </div>
    </>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid content-start gap-1.5 rounded-xl bg-surface p-4 text-sm ring-1 ring-line">
      <span className="flex items-center gap-2 font-medium">
        <span className="grid size-6 place-items-center rounded-full bg-dye text-xs text-canvas">{n}</span>
        {title}
      </span>
      <p className="text-muted">{children}</p>
    </li>
  );
}

function Snippet({ title, note, children }: { title: string; note: string; children: string }) {
  return (
    <Panel className="grid content-start gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-xs text-muted">{note}</p>
      <pre className="overflow-x-auto rounded-lg bg-canvas p-3 font-mono text-xs leading-relaxed ring-1 ring-line">
        <code>{children}</code>
      </pre>
    </Panel>
  );
}

function Rule({ children }: { children: ReactNode }) {
  return <li className="rounded-lg bg-surface px-4 py-3 ring-1 ring-line">{children}</li>;
}
