# Open questions

Needs a team answer. Move each item to DECISIONS.md once settled.

## What does the hold cover?

The deck holds EUR 2,880, the full delivered cost. Duty and import VAT normally go to customs or a broker, not to the seller.

- Option A: hold goods and shipping only (EUR 2,540), and show duty and VAT as the buyer's border cost.
- Option B: treat the offer as delivered duty paid, so the whole amount is the seller's invoice.

This sets the PayPal order's line items.

## How far does the seller agent go?

Minimal is an MCP endpoint and scripted bots. Full is bots that price with their own LLM. Minimal is enough for the Agentic Commerce story.

## Still to verify

- Hold renewal: retest due on 10 Nov
- WhatsApp sending: needs a paid Twilio account, and probably a Content API template. Untested
- AG Grid licence terms for row grouping and master-detail in a public repo
- MCP inside a Next.js route handler
- Demo tender duty: it stays on the assumed 12% on purpose, marked "Demo rate" on screen. Easyship's checked rate for 6302.51 into Germany is 9.6% from Indonesia (EU GSP) and 0% from Vietnam (EU-Vietnam FTA); on those rates bid A lands at EUR 2,996, inside the budget, and bid B is cheapest delivered. Switching the demo to real rates changes the story the login page and pitch tell
- The earlier sandbox test scripts still need to be added to `sandbox-tests/`
