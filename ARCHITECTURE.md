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

There is no way back from AWARDED. See "No void" in DECISIONS.md. Two narrow exceptions: the buyer may end a phased order between phases, with no hold in place (IN_DELIVERY to COMPLETE), and PayPal's webhook reopens a completed tender whose final payment it denies afterwards (COMPLETE to IN_DELIVERY).

## Money flow

1. The buyer approves the winner, and FairBid creates an order with `intent=AUTHORIZE` and the seller as payee, for the first phase.
2. The buyer approves in the PayPal popup, and FairBid authorizes the order. The money stays in the buyer's account, reserved in the seller's name.
3. Each confirmed milestone is a partial capture to the seller from its phase's hold.
4. The last capture of a phase sets `final_capture: true`, which closes that hold. On the last phase it may be less than planned, and the rest is released to the buyer.
5. An order of up to 28 days is one phase. A longer one (up to 180 days) has one hold per phase (`src/lib/phases.ts`): when a phase is paid, the buyer approves the next phase's hold the same way. A hold that lapses with steps unpaid is replaced by a new one for what the phase still owes.
6. PayPal's webhook reports every hold and capture from PayPal's side (`src/lib/paypal-sync.ts`).

## Rules that must hold

- Every server action takes identity from the session, never from an argument. A server action is a public endpoint.
- Sealed bids never leave the server before close. Only the count does.
- Clarifications cannot change a price.
- A collusion flag asks a person to look. It never removes a bid.
- Anything other than `PAYPAL_ENV=sandbox` refuses to run.
