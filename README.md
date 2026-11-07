# FairBid

Fair cross-border tenders for small buyers. Sellers bid in sealed envelopes, AI prices every bid at what it really costs once delivered, and PayPal holds the money until the goods arrive.

Built for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/). All data is illustrative and all money is PayPal sandbox money.

## Status

Working now:

- Sign-in with demo accounts, quest board, tender page with sealed bids
- Postgres schema, migration, and a repeat-safe demo seed
- Landed-cost engine, checked against the demo tender's published figures
- Tender state machine and hash-chained event log
- PayPal client with the seller as payee, and a webhook route

Not built yet: the AI roles, clarification inbox, results grid, award screen, seller agents over MCP. The PayPal client is unit tested against a fake server and has not yet run against the live sandbox.

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

Set `SESSION_SECRET` in `.env` first (`openssl rand -base64 32`), then open http://localhost:3000 and pick a demo account.

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
