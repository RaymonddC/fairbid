# FairBid: notes for a new session

Hackathon project (PayPal AI Hackathon 2026, Devpost; submission closes 12 Nov 2026, 12:00 PST). Read `README.md`
first, then `DECISIONS.md`, `OPEN-QUESTIONS.md` and `ARCHITECTURE.md`. Screens follow `DESIGN.md`.

## Do not remove or weaken without asking

These carry the money and fairness story. Each one is a deliberate decision in `DECISIONS.md`.

- **Sandbox only.** `loadConfig` in `src/lib/paypal/client.ts` refuses anything but `PAYPAL_ENV=sandbox`.
- **The seller is the payee from order creation.** FairBid never holds money.
- **No void, refund or platform fee calls.** The sandbox refuses them with the seller as payee. Never claim void
  in the UI, docs or pitch. Unused budget goes back through `final_capture: true`. Do not use the word "escrow".
- **No hold has to outlive PayPal's 29 days.** Over 28 days of delivery, an order is paid in phases with one hold each
  (`src/lib/phases.ts`); a lapsed hold is replaced, never extended. Run `npm run check:phases` after touching money steps.
- **The first payment is a non-refundable deposit the buyer agreed to.** `startAward` refuses without `depositAccepted`.
- **Sealed bids stay on the server until close.** `isSealed` in `src/lib/tender.ts`; only the count leaves before.
- **Code ranks; the AI scores only what code cannot.** Delivered cost (`src/lib/landed.ts`), the cost, lead-time and
  completeness scores, the weighted total and ranking (`src/lib/scoring.ts`) and collusion pairs are computed in code.
  The AI scores the reviewed criteria (such as handmade proof) blind, each with a reason, and writes questions and
  reasons; the app says so where the scores show (DECISIONS.md, "The AI scores the criteria code cannot").
- **A collusion flag asks a person to look.** It never removes a bid.
- **The hash-chained event log** (`src/lib/audit.ts`, `audit-store.ts`): append only, never edit or delete events.
- **Identity comes from the session**, never from an action's arguments. A server action is a public endpoint.
- **Money is integer cents** everywhere.

## Working rules

- Once the app is live, a push to `main` deploys it. Work on a branch, then `git fetch origin main`, merge it into
  your branch, run the checks, and push to `main` only when the person you work for says so.
- Check before pushing: `npm test`, `npm run lint`, `npm run typecheck`. CI also runs `npm run build`.
- Docker image builds run in CI, not locally.
- Every new environment variable goes in `.env.example` with a comment, and in `deploy.yml` if production needs it.
- Secrets never go in the repo, in chat or in a commit. They live in `.env` locally and Secret Manager in production.
- Schema changes are a new Prisma migration (`npx prisma migrate dev --name ...`); never edit an applied one.
- The demo seed only touches the demo tender (`src/lib/demo-reset.ts`). Keep it that way: other tenders are real.
- The AI roles run on Gemini through Vertex AI (`src/lib/ai/model.ts`), model from `AI_MODEL`. With the AI off or failing
  they must fall back to their fixtures (`src/lib/ai/roles.ts`, `src/lib/review-fixture.ts`), so the whole flow always runs.
- Commit messages: one imperative sentence that says why.

## Run it

```bash
npm run db:up && npm run db:migrate && npm run db:seed && npm run dev
```

Demo sign-in: `anna@fairbid.demo` (buyer) or `sari@fairbid.demo` (seller), password `fairbid-demo`.
`/api/ready` says what is misconfigured and how to fix it.
