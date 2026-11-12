# FairBid

Fair cross-border tenders for small buyers. Sellers bid in sealed envelopes, AI prices every bid at what it really costs once delivered, and PayPal holds the money until the goods arrive.

Built for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/). All data is illustrative and all money is PayPal sandbox money.

## Status

Working now:

- Create a buyer or seller account, sign in with an email and password, or one click on a demo account
- Each buyer sees and runs only their own tenders; sellers see every open tender
- Buyer dashboard with cash flow; seller quest board
- Buyer steps: sealed bids, close, clarification inbox (in-app), delivered-cost compare with a blind score grid, award with the PayPal button, milestone payments
- Seller: sealed bid form with photos and a delivered-cost preview, replies to clarifications, payments received
- Every losing seller is told why, once the award is final (`src/lib/debrief.ts`): their rank, their score on each criterion against the winning bid's, the points each one cost them, and both delivered costs, on their bid page and through the `get_debrief` agent tool. The buyer sees the same debriefs under "What the other sellers see" on the award page. The winner's name, price lines and product reasons are never shown
- Five AI roles on Gemini through Vertex AI (`src/lib/ai/`): the tender writer drafts a tender from plain words, the HS classifier suggests the customs code, the proposal reviewer writes questions to sellers after close, the blind scorer judges the criteria code cannot, and the collusion reasoner explains why code paired two bids. Prompts are in `src/lib/ai/prompts.ts`. Without the AI, or when a call fails, each role answers from its scripted fixture, so the flow always runs
- Seller agents over MCP (`/api/mcp`, Streamable HTTP, one API key per seller): tools to list open tenders, read one, seal a bid, check its status, answer questions and, after losing, read why. Any seller can connect their own AI agent: **Make a key** on the seller dashboard (shown once, stored only as a sha256, revocable), then follow the public guide at `/agents`, which has setup for Claude Code, Claude Desktop and other MCP clients. Verified 8 Nov 2026: Claude Code connected with a dashboard-made key and called the tools; a revoked key gets 401. Four scripted agents (`src/lib/agents/bots.ts`, `npm run bots`) bid and answer through it; two of them coordinate, and the collusion screen flags them. The demo buyer's **Invite seller agents** button runs them on a tender; other accounts do not get it, so no real tender gets scripted bids
- Telegram for sellers (`src/lib/channels/`): a seller links a Telegram chat from their dashboard with a one-time code. A buyer's question then also arrives there, and a reply sent from that chat is recorded through the same `addReply` as the inbox, with the same checks and an activity-log line that names the channel. The in-app inbox stays the core path; with no channel configured nothing changes
- A live activity log that refreshes itself, with agent and AI events labelled
- Post a tender, Reset demo
- Money steps are safe to repeat: PayPal calls time out and retry with their idempotency key, a lost hold is read back from the order, a double click pays once, and repeated webhooks are ignored
- Orders longer than a PayPal hold: up to 180 days, paid in phases with one hold each, a lapsed hold replaced for what its phase still owes, and the buyer able to end the order between phases. `npm run check:phases` runs four orders end to end against the local database with a stand-in PayPal
- PayPal's webhook keeps the records honest after the fact: a payment held for review shows as pending until PayPal completes or denies it, a denied payment reopens its step, a lapsed hold is shown as gone, and a seller's refund is recorded. Every report appears in the activity log as PayPal's own line
- Postgres schema, migration, and a repeat-safe demo seed
- Landed-cost engine, checked against the demo tender's published figures
- Tender state machine and hash-chained event log
- PayPal client with the seller as payee, and a verified, replay-safe webhook route

Telegram is verified live (question to the seller's chat, reply in the inbox and activity log). The demo tender keeps its scripted questions, because its seeded replies answer them; every other tender gets the reviewer's own questions. The AI roles have only run on their fixtures so far: no live Claude call has been tested yet. Verified in the sandbox on 8 Nov 2026 through this code: a German personal account approved a EUR 2,540 hold with Sari as payee, then two partial captures (762, 1,016) and a final capture of 700 released the remaining 62.

## Guardrails, and where they live in code

| Guardrail | Enforcement |
|---|---|
| Sandbox money only | `loadConfig` refuses anything but `PAYPAL_ENV=sandbox` (`src/lib/paypal/client.ts`) |
| FairBid never holds money | The seller is the PayPal payee from the moment the order is created (`startAward`, `src/lib/workflow.ts`) |
| Nobody sees a bid before close | `isSealed` (`src/lib/tender.ts`); while sealed, `getTenderView` builds no bid views at all, only the count (`src/lib/tender-data.ts`) |
| No late bids | `canSubmitBid` checks the state and the closing time on the server (`src/lib/tender.ts`) |
| Bids compared on what the buyer really pays | Goods, shipping, duty, VAT and fees in integer cents (`src/lib/landed.ts`) |
| Code ranks; the AI scores only what code cannot | Delivered cost, cost, lead-time and completeness scores, the weighted ranking and collusion pairs are computed in code (`src/lib/scoring.ts`). The AI scores reviewed criteria such as handmade proof, blind and with a reason, so two runs can rank close bids differently; the app says so, and the buyer decides |
| A collusion flag never removes a bid | `findCoordinatedPairs` only flags a pair for the buyer to look at (`src/lib/scoring.ts`) |
| Questions cannot leak an early hint | `askQuestion` refuses while bidding is open, and after a winner is chosen (`src/lib/workflow.ts`) |
| No hold has to outlive PayPal's 29 days | Orders of up to 28 days get one hold. Longer orders, up to 180 days, are paid in phases: each phase's steps fall due within 28 days, and each phase gets its own hold, approved by the buyer when it starts (`planMilestones`, `nextStep`, `src/lib/phases.ts`). A hold that lapses with money owed can be replaced, never stretched |
| The deposit is agreed, not assumed | The first step is a non-refundable deposit. The buyer must tick it before PayPal appears, the server refuses an award without it, and the agreed amount is in the award's event (`startAward`) |
| Seller never works uncovered | A phase can only be paid from a live hold for that phase; the seller sees whether the next phase is held, and the buyer can end the order only between phases, when no hold is in place (`captureMilestone`, `endOrder`, `src/lib/workflow.ts`) |
| Payments in order, never over the hold | `captureMilestone` pays the next step only, and refuses more than is left (`src/lib/workflow.ts`) |
| Unused budget goes back to the buyer | The last capture sets `final_capture: true`, which closes the hold. No void or refund calls exist, because the sandbox refuses them with the seller as payee |
| Every step on the record | A hash-chained event log; changing any past event breaks the chain (`src/lib/audit.ts`) |
| PayPal is the second witness | PayPal's webhook reports every hold and payment from its side, including changes made later (a payment denied after review, a lapsed hold, a seller's refund). Each report is verified with PayPal, applied once, and logged as actor `paypal` (`src/lib/paypal/webhook.ts`, `src/lib/paypal-sync.ts`) |
| A seller's agent acts only as that seller | Its key maps to one seller; a key is stored as a sha256 and works only until revoked (`src/lib/mcp/agent-keys.ts`); every tool calls the same `workflow.ts` functions as the screens |
| Only the owner runs a tender | Identity comes from the session cookie, never from a form; `assertOwner` checks the buyer (`src/app/actions.ts`, `src/lib/workflow.ts`) |

## Cost

For the demo tender: a EUR 2,540 hold paid out in three milestones of 762, 1,016 and 700.

| Item | Who pays | About |
|---|---|---|
| PayPal fee on what the seller receives | The seller, deducted by PayPal | EUR 110: 4.40% plus EUR 0.35 per capture, the rate for an Indonesian seller paid from abroad ([PayPal Indonesia fees](https://www.paypal.com/id/webapps/mpp/merchant-fees), read 8 Nov 2026). Converting the euros to rupiah adds 3.0% |
| FairBid's fee | Nobody | EUR 0. Platform fees need PayPal Multiparty, which the sandbox does not offer with the seller as payee |
| Gemini 3.8 Flash on Vertex AI, five AI roles | FairBid | Under US$0.10 per tender at list price ($1.50 in, $7.50 out per million tokens, thinking billed as output; third-party listings, not Google's own page), assuming about 2,000 tokens in and 2,000 out per call |
| Hosting | FairBid | About US$10 a month for the Cloud SQL database, charged even when idle. Cloud Run scales to zero and stays inside the free tier at demo traffic |

Duty, import VAT and the customs broker (EUR 340 on the demo tender) are the buyer's border costs, paid at the border, not through FairBid. They still count when bids are compared.

## Run it

You need Node 24 and Docker.

```bash
cp .env.example .env
npm install
npx prisma generate
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

Set `SESSION_SECRET` in `.env` first (`openssl rand -base64 32`), then open http://localhost:3000. Pick a demo account, or sign in with `anna@fairbid.demo` (buyer) or `sari@fairbid.demo` (seller) and the password `fairbid-demo` (set `DEMO_PASSWORD` to change it).

## Check it

```bash
npm test
npm run lint
npm run typecheck
```

When something is not working, open `/api/ready`. It checks the database and PayPal, and says what to do about each failure.

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md): how it fits together
- [DECISIONS.md](DECISIONS.md): what we chose and why
- [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md): what the team has not agreed yet
- [DEPLOY.md](DEPLOY.md): Cloud Run setup, and how to switch on Telegram
- [DEMO-RUNBOOK.md](DEMO-RUNBOOK.md): pre-flight, timed beats, fallbacks, judge questions

## License

MIT
