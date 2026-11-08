# Decisions

What we chose and why. Open items are in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md).

## Seller as payee

The order names the winning seller as payee from the first call. FairBid never holds funds, which is what lets us say the money is held by PayPal and not by us. Sandbox testing on 7 Nov confirmed the hold, two partial captures, and a final capture, with FairBid receiving nothing.

## No void

With the seller as payee, the sandbox refuses void (`PERMISSION_DENIED`), refund, and platform commission (`PLATFORM_FEES_NOT_SUPPORTED`). All three need PayPal Multiparty in production. So the client has no such calls, and the state machine has no exit from AWARDED. Unused budget returns through `final_capture: true`.

## A hold is not escrow

An authorization reserves money in the buyer's account. It does not move it. If the buyer cannot cover the amount, authorization fails at award, before the seller starts work. A later capture can still fail, so milestones keep the amount at risk small. Do not use the word escrow.

## One hold per phase, each inside 29 days

A PayPal authorization is valid for 29 days. Within them, a capture is guaranteed for the first 3 days (the honor period); after that it is still allowed, but subject to the buyer's funds. Reauthorizing after the honor period confirms the funds and starts a new 3-day honor period, as often as needed, but it never extends the 29 days: PayPal's reference says that after 30 days a new authorization is required. FairBid does not reauthorize until the retest due on 10 Nov passes.

So no hold may have to last longer than 28 days. An order of up to 28 days is one phase with one hold, as it always was. A longer order, up to 180 days, is split into phases (`src/lib/phases.ts`): production checkpoints are added so no two steps are more than 28 days apart, and consecutive steps due within 28 days of a phase's start share that phase. Each phase gets its own hold, for exactly what its steps cost, approved by the buyer in PayPal when the phase starts. The last step of a phase is a final capture, which closes that hold.

Two things follow, and both are deliberate:

- **The seller starts a phase only once it is held.** A step can only be paid from a live hold for its phase, and the seller's page says whether the next phase is held. Between phases, with no hold in place, the buyer may end the order: what was paid stays paid, and the rest was never held, so it is never charged. A live hold cannot be ended that way, because FairBid cannot void a hold that pays the seller.
- **A hold that lapses is replaced, never stretched.** If production runs late and a phase's hold expires with steps unpaid, the unused money goes back to the buyer on its own and the buyer is asked for a new hold of what the phase still owes. The seller is told to wait for it.

The cost is one PayPal approval per phase, for example three for a two-month order. That is the price of never claiming a hold PayPal does not give.

## The first payment is a non-refundable deposit

Phases are paid as the work moves, not as goods arrive. So if a buyer stops after phase 1, for example because PayPal declines the next hold, the buyer has paid the first step and holds no goods yet; the seller has bought materials and started work. Rather than hide that, FairBid says it up front: the first step ("Production started", 30%) is a non-refundable deposit. The buyer ticks a box agreeing to it before the PayPal button appears, the server refuses an award without that agreement (`startAward`), and the agreed amount is written into the award's event. Every screen that lists the steps labels the deposit.

The fairer long-term design is pay per shipped batch: split a long order into batches, each held, made, shipped with tracking and paid on shipment, so the buyer's money always buys goods that have left the workshop. It needs no hold longer than 28 days either. Chosen against for now (8 Nov 2026) to keep the current phases for the hackathon.

## PayPal's webhook is the second witness

FairBid records each money step from PayPal's answer to its own call. PayPal's webhook then reports the same step from PayPal's side, plus anything that changes later: a payment held for review that completes or is denied days on, a hold that lapses, a seller who refunds from their own account. Each report is verified with PayPal, applied once, and appended to the tender's event log as actor `paypal`, so the log shows two independent sources for every payment. A record only moves forward; a payment denied after the fact reopens its step so the buyer can pay it again.

## In-app inbox first

Devpost requires that judges can run the build themselves. A flow that needs team phones in a Twilio sandbox fails that, so the in-app inbox is the core path and WhatsApp is an optional channel for the video.

## One Next.js app, on Cloud Run

One deployable, one language, and shared types in place of an API document. Hosting on Cloud Run gives up the Render sponsor prize, which is credits only, for a pipeline the team already knows.

## Cloud SQL, with every resource named fairbid-

Everything stays inside Google Cloud. Every resource is named `fairbid-…`, including the GitHub sign-in pool, so FairBid can share a billed project with another service without touching it. The database is the smallest shared-core Cloud SQL Postgres. It costs about US$10 a month even when idle, so delete it after judging. It accepts no direct connections: Cloud Run uses the Cloud SQL connector, and CI migrations go through the Cloud SQL proxy.

## Gemini on Vertex AI for the AI roles

The service already runs on Google Cloud, so the roles call Gemini through Vertex AI as the service's own account: no API key to create, store or leak, and the cost sits on the same bill. Gemini 3.8 Flash is the default because, in a test on 8 Nov, it gave the right customs code for cotton napkins (6302.51) where 2.5 Flash did not. 2.5 Flash stays as a one-time fallback. Every role still has a scripted fixture, so the flow runs with the AI off.

## The buyer may close bidding early

A buyer can close bidding before the published deadline (R's call, 8 Nov 2026). The risk is a buyer closing right after a favoured seller bids; prices are sealed, so the buyer cannot see who is cheapest, but they can see the count. So an early close is never hidden: the event log records the published deadline next to the real closing time and says "closed early", and the hash chain keeps it from being edited away.

## Scripted seller agents are for the demo accounts only

"Invite seller agents" adds four scripted sellers to a tender. That shows MCP agents working, but on a real buyer's tender it would put fake bids next to real ones. So only the shared demo accounts can invite them, on tenders they own (R's call, 8 Nov 2026); the server refuses anyone else (`inviteAgentsAction`), and the button is not shown to them. Every bid an agent seals is signed `agent:<seller>` in the event log. A real seller's own agent can still bid on any open tender through `/api/mcp` with that seller's key.

## "Good" means the buyer's published criteria

FairBid does not decide what is good. The buyer publishes criteria before bidding opens, and every bid is judged against them with a written reason.

## Deterministic where it matters

Delivered cost and collusion pairing are computed in code. The LLM writes reasons only, so two runs cannot rank bids differently.
