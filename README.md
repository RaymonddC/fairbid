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
- Five AI roles on Claude (`src/lib/ai/`): the tender writer drafts a tender from plain words, the HS classifier suggests the customs code, the proposal reviewer writes questions to sellers after close, the blind scorer judges the criteria code cannot, and the collusion reasoner explains why code paired two bids. Prompts are in `src/lib/ai/prompts.ts`. Without `ANTHROPIC_API_KEY`, or when a call fails, each role answers from its scripted fixture, so the flow always runs
- Post a tender, Reset demo
- Money steps are safe to repeat: PayPal calls time out and retry with their idempotency key, a lost hold is read back from the order, a double click pays once, and repeated webhooks are ignored
- Postgres schema, migration, and a repeat-safe demo seed
- Landed-cost engine, checked against the demo tender's published figures
- Tender state machine and hash-chained event log
- PayPal client with the seller as payee, and a webhook route

Not built yet: seller agents over MCP, WhatsApp and Telegram. The demo tender keeps its scripted questions, because its seeded replies answer them; every other tender gets the reviewer's own questions. The AI roles have only run on their fixtures so far: no live Claude call has been tested yet. Verified in the sandbox on 8 Nov 2026 through this code: a German personal account approved a EUR 2,540 hold with Sari as payee, then two partial captures (762, 1,016) and a final capture of 700 released the remaining 62.

## Guardrails, and where they live in code

| Guardrail | Enforcement |
|---|---|
| Sandbox money only | `loadConfig` refuses anything but `PAYPAL_ENV=sandbox` (`src/lib/paypal/client.ts`) |
| FairBid never holds money | The seller is the PayPal payee from the moment the order is created (`startAward`, `src/lib/workflow.ts`) |
| Nobody sees a bid before close | `isSealed` (`src/lib/tender.ts`); while sealed, `getTenderView` builds no bid views at all, only the count (`src/lib/tender-data.ts`) |
| No late bids | `canSubmitBid` checks the state and the closing time on the server (`src/lib/tender.ts`) |
| Bids compared on what the buyer really pays | Goods, shipping, duty, VAT and fees in integer cents (`src/lib/landed.ts`) |
| Code ranks, the AI only explains | Scores and collusion pairs are computed in code (`src/lib/scoring.ts`); an LLM writes reasons and questions, so two runs cannot rank bids differently |
| A collusion flag never removes a bid | `findCoordinatedPairs` only flags a pair for the buyer to look at (`src/lib/scoring.ts`) |
| Questions cannot leak an early hint | `askQuestion` refuses while bidding is open, and after a winner is chosen (`src/lib/workflow.ts`) |
| The hold covers the whole delivery | Delivery is capped at 28 days, inside PayPal's 29-day authorization (`publishTender`, `src/lib/workflow.ts`) |
| Payments in order, never over the hold | `captureMilestone` pays the next step only, and refuses more than is left (`src/lib/workflow.ts`) |
| Unused budget goes back to the buyer | The last capture sets `final_capture: true`, which closes the hold. No void or refund calls exist, because the sandbox refuses them with the seller as payee |
| Every step on the record | A hash-chained event log; changing any past event breaks the chain (`src/lib/audit.ts`) |
| Only the owner runs a tender | Identity comes from the session cookie, never from a form; `assertOwner` checks the buyer (`src/app/actions.ts`, `src/lib/workflow.ts`) |

## Cost

For the demo tender: a EUR 2,540 hold paid out in three milestones of 762, 1,016 and 700.

| Item | Who pays | About |
|---|---|---|
| PayPal fee on what the seller receives | The seller, deducted by PayPal | EUR 110: 4.40% plus EUR 0.35 per capture, the rate for an Indonesian seller paid from abroad ([PayPal Indonesia fees](https://www.paypal.com/id/webapps/mpp/merchant-fees), read 8 Nov 2026). Converting the euros to rupiah adds 3.0% |
| FairBid's fee | Nobody | EUR 0. Platform fees need PayPal Multiparty, which the sandbox does not offer with the seller as payee |
| Claude, five AI roles | FairBid | Estimate, until real runs are measured: about US$0.30 per tender on Claude Opus 5.5 ($4 in, $20 out per million tokens), assuming about 6,000 tokens in and 1,500 out per role |
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
- [DEPLOY.md](DEPLOY.md): Cloud Run setup

## License

MIT
