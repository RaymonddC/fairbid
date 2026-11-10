# Demo runbook

For recording the video and for a live demo. Target: under 3 minutes.

## Pre-flight (10 minutes before)

1. Open `<service url>/api/ready`. Database and PayPal must say ok. "llm" says whether the AI is live or on scripted answers; both work.
2. Open the site once to wake it, or set `MIN_INSTANCES=1` for judging week (DEPLOY.md).
3. Sign in as Anna (buyer). On the demo tender, press **Reset demo**: four sealed bids again, no award, no payments.
4. Check the `SELLER_D_PAYPAL_EMAIL` repo variable holds Sari's sandbox business account. Without it PayPal refuses the award.
5. Check the `PAYPAL_WEBHOOK_ID` repo variable is set. With it, a few seconds after each payment the activity log gains a line from PayPal itself ("Reported by PayPal's webhook"). Without it the flow still works; the log just has FairBid's lines only.
6. Have the PayPal sandbox buyer login ready for the popup. Never a real account.
7. Close other tabs and turn on do-not-disturb. Record at 1280 wide.

## Beats

| Time | Screen | Say |
|---|---|---|
| 0:00 | Buyer dashboard | A small hotel group buys abroad. The cheapest quote is rarely the cheapest delivered, and paying up front is a risk. |
| 0:15 | Post a tender | Plain words in. The AI drafts the tender; Anna checks every field. A PayPal hold lasts 29 days, so a longer order is held one phase at a time; the form says how many holds. |
| 0:35 | New tender (signed in as Anna: the agents are demo-only), **Invite seller agents** | Four seller agents read the tender over MCP and seal their bids. Nobody, Anna included, sees a price before close. Open **Activity log**: each bid is signed by its agent. |
| 0:55 | Demo tender, **Close bidding now** | Every bid opens at once. The AI review sends the same question to every bid with the same gap. **Let seller agents answer**: traders B and C send the same sentence. |
| 1:20 | Compare, **Delivered cost** | Switch from quoted price to delivered cost: duty, VAT and fees reorder the bids. B and C are flagged: prices 0.4% apart, the same text. A flag asks a person to look; it removes nothing. |
| 1:45 | Award bid D | Anna picks Sari and ticks that the first 30% is a non-refundable deposit. PayPal holds EUR 2,540 in Anna's account with Sari as the payee. FairBid never touches the money. |
| 2:10 | Pay milestones | 30% when production starts, 40% when shipped, the rest on delivery. The last capture is final and releases what was not used. |
| 2:35 | Activity log | Every step is in a hash chain. Change one event and the tamper check breaks. Each payment has two lines: FairBid's, and PayPal's own webhook confirming it. |
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
| No PayPal line appears in the log after a payment | PayPal delivers within seconds, sometimes a minute. Say nothing; FairBid's own line is already there. If it never comes, `PAYPAL_WEBHOOK_ID` is missing or stale (DEPLOY.md) |
| A payment shows "PayPal is holding" | Sandbox eCheck or a review. Nothing is wrong: the step is recorded as pending and completes when PayPal reports back. Move on |

## Questions judges may ask

- **Is this escrow?** No. PayPal authorizes the money in the buyer's account, in the seller's name. Nobody else holds it.
- **Can the buyer cancel after award?** Not in this build. With the seller as payee, voiding a hold needs PayPal Multiparty, which the sandbox does not offer here. The final capture releases whatever was not used.
- **What if delivery takes longer than 29 days?** A PayPal hold is valid for 29 days and cannot be extended: reauthorizing only renews the 3-day guarantee inside those 29. So a longer order, up to 180 days, is paid in phases, each with its own hold that the buyer approves when the phase starts. A two-month order is three holds. If production runs late and a hold lapses, the buyer places a new one for what that phase still owes; the seller is told to wait. Between phases the buyer can end the order, and what was never held is never charged.
- **What if the buyer cannot cover the next phase?** PayPal declines the hold when the buyer approves it, so nothing is reserved and nothing can be paid for that phase; the attempt goes in the log. The seller's page keeps saying the phase is not held, so the seller has not started it. The buyer can try another funding source or end the order; the seller keeps everything paid so far, including the first payment, which the buyer agreed at award is a non-refundable deposit for materials and work. Inside a phase that is already held, a payment is guaranteed for 3 days and still allowed after that, subject to the buyer's funds; a declined payment leaves the step open and is logged.
- **What if PayPal changes something after you recorded it?** PayPal's webhook tells us. A payment held for review shows as pending until PayPal completes or denies it; a denied payment reopens its step; a lapsed hold is shown as gone; a seller's refund is recorded. Every report is verified with PayPal and lands in the log as PayPal's own line.
- **Does the AI choose the winner?** No, but it does score part of each bid, and we say so. Code computes delivered cost, the cost, lead-time and completeness scores, the weighted ranking, and which bids look coordinated. The AI scores the judgement calls code cannot make, such as handmade proof, blind (it sees a letter, never a name or a price), and every one of its scores comes with a reason. It also drafts the tender and asks the questions. The buyer decides.
- **Can a seller see other bids?** No. Before close only the count leaves the server. Over MCP, an agent's key only ever reads its own bid.
- **What does it cost?** See README, "Cost".
