# Architecture

One Next.js app owns all state and secrets. Screens use server components and server actions. Seller agents come in through MCP. PayPal and Twilio call back through route handlers. All of them reach the same functions in `src/lib`, so a bid from a bot and a bid from the form follow one code path.

## Layout

| Path | Holds |
|---|---|
| `src/lib/tender.ts` | The shared contract: states, transitions, the sealed rule, milestones. Pure |
| `src/lib/landed.ts` | Goods + shipping + duty + VAT + fees, in integer cents. Pure |
| `src/lib/audit.ts` | Hash chain and verification. Pure |
| `src/lib/audit-store.ts` | Writes events to Postgres under a row lock |
| `src/lib/paypal/` | The only code that talks to PayPal |
| `src/lib/session*.ts` | Signed session cookie |
| `src/proxy.ts` | Login gate and per-request CSP nonce |
| `prisma/` | Schema, migrations, seed |

Pure files have no database or browser access, so server and client can both import them and tests need no setup.

## Tender states

```text
DRAFT → OPEN → CLOSED → REVIEWING → [CLARIFYING] → PRICED → SCORED → AWARDED → IN_DELIVERY → COMPLETE
                                                               ↘ CANCELLED
```

There is no way back from AWARDED. See "No void" in DECISIONS.md.

## Money flow

1. The buyer approves the winner, and FairBid creates an order with `intent=AUTHORIZE` and the seller as payee.
2. The buyer approves in the PayPal popup, and FairBid authorizes the order. The money stays in the buyer's account, reserved in the seller's name.
3. Each confirmed milestone is a partial capture to the seller.
4. The last capture sets `final_capture: true`, which closes the hold and releases anything unused to the buyer.

## Rules that must hold

- Every server action takes identity from the session, never from an argument. A server action is a public endpoint.
- Sealed bids never leave the server before close. Only the count does.
- Clarifications cannot change a price.
- A collusion flag asks a person to look. It never removes a bid.
- Anything other than `PAYPAL_ENV=sandbox` refuses to run.
