# Demo runbook

For recording the video and for a live demo. Target: under 3 minutes.

## Pre-flight (10 minutes before)

1. Open `<service url>/api/ready`. Database and PayPal must say ok. "llm" says whether the AI is live or on scripted answers; both work.
2. Open the site once to wake it, or set `MIN_INSTANCES=1` for judging week (DEPLOY.md).
3. Sign in as Anna (buyer). On the demo tender, press **Reset demo**: four sealed bids again, no award, no payments.
4. Check the `SELLER_D_PAYPAL_EMAIL` repo variable holds Sari's sandbox business account. Without it PayPal refuses the award.
5. Have the PayPal sandbox buyer login ready for the popup. Never a real account.
6. Close other tabs and turn on do-not-disturb. Record at 1280 wide.

## Beats

| Time | Screen | Say |
|---|---|---|
| 0:00 | Buyer dashboard | A small hotel group buys abroad. The cheapest quote is rarely the cheapest delivered, and paying up front is a risk. |
| 0:15 | Post a tender | Plain words in. The AI drafts the tender; Anna checks every field. Delivery is capped at 28 days because a PayPal hold lasts 29. |
| 0:35 | New tender, **Invite seller agents** | Four seller agents read the tender over MCP and seal their bids. Nobody, Anna included, sees a price before close. Open **Activity log**: each bid is signed by its agent. |
| 0:55 | Demo tender, **Close bidding now** | Every bid opens at once. The AI review sends the same question to every bid with the same gap. **Let seller agents answer**: traders B and C send the same sentence. |
| 1:20 | Compare, **Delivered cost** | Switch from quoted price to delivered cost: duty, VAT and fees reorder the bids. B and C are flagged: prices 0.4% apart, the same text. A flag asks a person to look; it removes nothing. |
| 1:45 | Award bid D | Anna picks Sari. PayPal holds EUR 2,540 in Anna's account with Sari as the payee. FairBid never touches the money. |
| 2:10 | Pay milestones | 30% when production starts, 40% when shipped, the rest on delivery. The last capture is final and releases what was not used. |
| 2:35 | Activity log | Every step is in a hash chain. Change one event and the tamper check breaks. |
| 2:50 | Close | Fair for the buyer, fair for the small seller, paid by PayPal only on delivery. |

## If something goes wrong

| Problem | Do this |
|---|---|
| A page is slow to load | Cold start. Wait 10 seconds; next time warm it with `/api/health` first |
| The AI answers look scripted | The key is missing or a call failed. The flow still works; say "scripted for the demo" or turn the key on (DEPLOY.md) |
| PayPal says "did not answer in time" | Press the same button again. Every money call has an idempotency key, so a repeat never pays twice |
| PayPal refuses the award, payee invalid | `SELLER_D_PAYPAL_EMAIL` is wrong or empty. Fix it, then **Reset demo** |
| Invite seller agents fails | Run them from a terminal (DEPLOY.md, "Seller agents"), or skip to the demo tender: its four bids are already in |
| The demo tender is in a strange state | **Reset demo** |

## Questions judges may ask

- **Is this escrow?** No. PayPal authorizes the money in the buyer's account, in the seller's name. Nobody else holds it.
- **Can the buyer cancel after award?** Not in this build. With the seller as payee, voiding a hold needs PayPal Multiparty, which the sandbox does not offer here. The final capture releases whatever was not used.
- **What if delivery takes longer than 29 days?** The tender caps delivery at 28 days. Renewing a hold is not claimed until it is tested.
- **Does the AI choose the winner?** No. Code computes delivered cost, the cost and lead-time scores, and which bids look coordinated. The AI drafts, asks, and explains. The buyer decides.
- **Can a seller see other bids?** No. Before close only the count leaves the server. Over MCP, an agent's key only ever reads its own bid.
- **What does it cost?** See README, "Cost".
