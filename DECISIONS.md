# Decisions

What we chose and why. Open items are in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md).

## Seller as payee

The order names the winning seller as payee from the first call. FairBid never holds funds, which is what lets us say the money is held by PayPal and not by us. Sandbox testing on 7 Nov confirmed the hold, two partial captures, and a final capture, with FairBid receiving nothing.

## No void

With the seller as payee, the sandbox refuses void (`PERMISSION_DENIED`), refund, and platform commission (`PLATFORM_FEES_NOT_SUPPORTED`). All three need PayPal Multiparty in production. So the client has no such calls, and the state machine has no exit from AWARDED. Unused budget returns through `final_capture: true`.

## A hold is not escrow

An authorization reserves money in the buyer's account. It does not move it. If the buyer cannot cover the amount, authorization fails at award, before the seller starts work. A later capture can still fail, so milestones keep the amount at risk small. Do not use the word escrow.

## Delivery fits inside 29 days

An authorization is honored for 3 days and stays valid for 29. The delivery window is capped inside that. Reauthorization is not claimed until the retest due on 10 Nov passes.

## In-app inbox first

Devpost requires that judges can run the build themselves. A flow that needs team phones in a Twilio sandbox fails that, so the in-app inbox is the core path and WhatsApp is an optional channel for the video.

## One Next.js app, on Cloud Run

One deployable, one language, and shared types in place of an API document. Hosting on Cloud Run gives up the Render sponsor prize, which is credits only, for a pipeline the team already knows.

## Cloud SQL, with every resource named fairbid-

Everything stays inside Google Cloud. Every resource is named `fairbid-…`, including the GitHub sign-in pool, so FairBid can share a billed project with another service without touching it. The database is the smallest shared-core Cloud SQL Postgres. It costs about US$10 a month even when idle, so delete it after judging. It accepts no direct connections: Cloud Run uses the Cloud SQL connector, and CI migrations go through the Cloud SQL proxy.

## "Good" means the buyer's published criteria

FairBid does not decide what is good. The buyer publishes criteria before bidding opens, and every bid is judged against them with a written reason.

## Deterministic where it matters

Delivered cost and collusion pairing are computed in code. The LLM writes reasons only, so two runs cannot rank bids differently.
