# FairBid

Fair cross-border tenders for small buyers. Sellers bid in sealed envelopes, AI prices every bid at what it really costs once delivered, and PayPal holds the money until the goods arrive.

Built for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/). All data is illustrative and all money is PayPal sandbox money.

## Status

Working now:

- Sign in with an email and password, or one click on a demo account
- Buyer dashboard with cash flow; seller quest board
- Buyer steps: sealed bids, close, clarification inbox (in-app), delivered-cost compare with a blind score grid, award with the PayPal button, milestone payments
- Seller: sealed bid form with photos and a delivered-cost preview, replies to clarifications, payments received
- Post a tender (scripted draft), Reset demo
- Postgres schema, migration, and a repeat-safe demo seed
- Landed-cost engine, checked against the demo tender's published figures
- Tender state machine and hash-chained event log
- PayPal client with the seller as payee, and a webhook route

Not built yet: the AI roles (questions and the handmade score come from `src/lib/review-fixture.ts`), WhatsApp and Telegram, seller agents over MCP. Verified in the sandbox on 8 Nov 2026 through this code: a German personal account approved a EUR 2,540 hold with Sari as payee, then two partial captures (762, 1,016) and a final capture of 700 released the remaining 62.

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
