# Open questions

Needs a team answer. Move each item to DECISIONS.md once settled.

## What does the hold cover?

The deck holds EUR 2,880, the full delivered cost. Duty and import VAT normally go to customs or a broker, not to the seller.

- Option A: hold goods and shipping only (EUR 2,540), and show duty and VAT as the buyer's border cost.
- Option B: treat the offer as delivered duty paid, so the whole amount is the seller's invoice.

This sets the PayPal order's line items.

## Which database on GCP?

`DATABASE_URL` works with either. Cloud SQL matches the team's last project but bills while idle and needs a proxy for migrations from CI. A hosted Postgres with a free tier reaches CI directly.

## Which GCP project?

A separate project keeps a mistake here away from any other running service.

## How far does the seller agent go?

Minimal is an MCP endpoint and scripted bots. Full is bots that price with their own LLM. Minimal is enough for the Agentic Commerce story.

## WhatsApp or Telegram?

WhatsApp fits the Indonesian seller story. Telegram is free and a judge can try it in a minute. Both sit behind one interface, so this can wait until the inbox works.

## Still to verify

- Hold renewal: retest due on 10 Nov
- Tax, shipping and handling in the order breakdown, against the real sandbox
- Twilio trial terms
- AG Grid licence terms for row grouping and master-detail in a public repo
- MCP inside a Next.js route handler
- Real duty rate for the demo product. 12% is a demo assumption
- The earlier sandbox test scripts still need to be added to `sandbox-tests/`
