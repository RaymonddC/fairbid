# Demo runbook

For recording the video and for a live demo. Target: under 3 minutes.

## Pre-flight (10 minutes before)

1. Open `<service url>/api/ready`. Database and PayPal must say ok. "llm" should say "Live model"; on scripted answers the flow still works, and every AI step says it was scripted.
2. Open the site once to wake it (`MIN_INSTANCES=1` keeps one instance warm, DEPLOY.md).
3. Sign in as Anna (tender owner). On the demo tender, press **Reset demo**: the batik napkins tender with four sealed bids, no award and no payments, plus six more open tenders (batik table runners and scarves, ceramic mugs, rattan lampshades, coffee beans, teak boards) with no bids.
4. Sign in as Sari (bidder), open **Your agent**, clear the box, untick **Bid for me automatically** and press **Save**, so the agent starts from nothing on camera.
5. Optional, for the Telegram moment: link your phone as Sari (her dashboard, Telegram, Link) and as Anna (her dashboard). On the shared demo accounts the last person to link holds the chat, so do it right before recording.
6. Check the `SELLER_D_PAYPAL_EMAIL` and `PAYPAL_WEBHOOK_ID` repo variables are set. Have the PayPal sandbox buyer login ready for the popup. Never a real account.
7. Close other tabs, turn on do-not-disturb, record at 1280 wide.

## Beats: AI agents on both sides of a fair tender

| Time | Screen | Say |
|---|---|---|
| 0:00 | Sign-in page (the tender sheet plays) | The lowest quote is rarely the lowest cost. A small hotel group buys batik abroad; the cheapest quote lands over budget once shipping, duty and fees are added. |
| 0:15 | As Anna: **Post a tender** | Anna writes what she needs in plain words. Her AI drafts the tender: item, quantity, budget, deadline and criteria. She checks every field and publishes. |
| 0:35 | As Sari: **Your agent** | Sari writes one paragraph: what she makes, her price per piece, shipping, how fast. She ticks **Bid for me automatically** and presses **Look at open tenders now**. |
| 0:50 | Same page, "What your agent did" | Her agent skipped the mugs, lampshades, coffee and teak boards (not her product), asked the tender owner a question where the tender left something out, and sealed bids on the batik tenders from her own prices. Nobody sees a price before close. |
| 1:10 | As Anna: that batik tender | The bid count went up; the price stays sealed. Under **Bidders' questions**, her AI already answered what the tender settles; the answer goes to every bidder, and nobody is told who asked. (Telegram: Anna's phone shows each bidder agent's question with her agent's answer, the sealed-bid count, and any question that waits for her, which she answers by replying. Sari's phone shows her agent's summary for each tender.) |
| 1:25 | Demo tender, **Close bidding now** | Every bid opens at once. The AI review sends the same question to every bid with the same gap. Sari's agent answers from her description; within a minute the other bidder agents answer on their own, each written by Gemini from that bidder's profile; traders B and C share one profile, so they send the same sentence. (Telegram: Anna can close bidding from the "Close bidding now" button on a new-bid message, and each answer arrives in her chat.) |
| 1:50 | **Compare**, **Delivered cost** | Duty, VAT and fees reorder the bids: the lowest quote is over budget. B and C are flagged: prices 0.4% apart, the same text; a flag asks a person to look and removes nothing. The AI scored handmade proof blind, with a reason; code ranked the bids. |
| 2:15 | **Award and pay** | Anna awards Sari and agrees the first 30% is a non-refundable deposit. PayPal holds EUR 2,540 in Anna's account with Sari as the payee; FairBid never touches the money. **Pay** the first step. |
| 2:35 | **AI** page | Everything the AI did on this tender, from the tamper-checked log: drafted, asked, scored blind, explained the flags. Code ranked; Anna decided. |
| 2:50 | Close | AI agents on both sides, sealed and fair: the best delivered offer wins, and PayPal pays only as the order moves. |

## If something goes wrong

| Problem | Do this |
|---|---|
| A page is slow to load | Cold start. Wait 10 seconds; next time warm it with `/api/health` first |
| The AI answers look scripted | The key is missing or a call failed. The flow still works; say "scripted for the demo" or turn the key on (DEPLOY.md) |
| PayPal says "did not answer in time" | Press the same button again. Every money call has an idempotency key, so a repeat never pays twice |
| PayPal refuses the award, payee invalid | `SELLER_D_PAYPAL_EMAIL` is wrong or empty. Fix it, then **Reset demo** |
| No scripted bids arrive within two minutes of publishing | `MCP_SELLER_KEYS` is empty or wrong (the service log says so, `[demo-agents]`). Run them from a terminal (DEPLOY.md, "Seller agents"), or skip to the demo tender: its four bids are already in |
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
