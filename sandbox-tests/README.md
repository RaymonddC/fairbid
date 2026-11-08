# Sandbox proof

PayPal's own records of real sandbox holds placed through the live app, read back and checked against what
FairBid claims. `readback.ts` only reads (GET): it never creates, captures or releases anything.

```bash
SELLER_D_PAYPAL_EMAIL=<seller sandbox account> npm run proof:paypal
```

For each authorization in `cases.json` it checks:

| Claim | What PayPal returns |
|---|---|
| The money is held, not paid up front | the order's `intent` is `AUTHORIZE` |
| The seller is paid, FairBid never holds the money | the order's and the hold's `payee` are the seller's account |
| A hold lasts 29 days | `expiration_time` is 29 days after `create_time` |
| A payment never exceeds the hold | captures add up to no more than the authorized amount |
| FairBid takes no cut | no `platform_fees` on any capture |
| A final payment closes the hold | after a `final_capture`, the hold's status is `CAPTURED` |

Result on 8 Nov 2026, four holds, all checks passed:

| Hold | Case | Held | Paid | Status |
|---|---|---|---|---|
| `7A666465816249120` | Demo tender, nothing paid yet | €2,540.00 | €0.00 | `CREATED` |
| `2W101654CX197861X` | 28-day order, two partial payments | €2,539.00 | €1,777.30 | `PARTIALLY_CAPTURED` |
| `07F795860P717924N` | 60-day order, phase 1 (deposit) | €2,284.80 | €2,284.80, final | `CAPTURED` |
| `1MR72702AU0112154` | 60-day order, phase 2, second hold on the same order | €3,046.40 | €3,046.40, final | `CAPTURED` |

The fees shown under each payment are PayPal's own processing fee, charged to the seller as on any PayPal payment.

## Not covered here

- **Releasing an unused remainder.** Both final payments above used the whole hold. A final capture of less than
  the hold, with the rest never charged, was confirmed in the 7 Nov sandbox test and in `npm run check:phases`.
- **Void, refund and platform fees.** With the seller as payee the sandbox refuses all three (7 Nov test), which is
  why FairBid uses none of them. Re-testing that needs a new hold, so it is not part of this read-only proof.
- **Renewing a hold (reauthorize).** Allowed only after PayPal's 3-day honour period; retest due on 11 Nov
  against `2W101654CX197861X`.
