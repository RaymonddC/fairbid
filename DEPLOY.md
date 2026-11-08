# Deploy

The app runs on Google Cloud Run with a Cloud SQL Postgres database. Pushes to `main` deploy through `.github/workflows/deploy.yml`. Until setup is done, that workflow skips cleanly.

## One-time setup

You need:

- A GCP project with billing enabled. It can be a project that already runs something else: every resource the script makes is named `fairbid-…`, and it changes nothing that exists
- An account that owns the project, and `gh` signed in to GitHub
- The PayPal sandbox client id and secret

From [Cloud Shell](https://shell.cloud.google.com), or any machine with `gcloud` and `gh`:

```bash
gh auth login
gh repo clone RaymonddC/fairbid
cd fairbid
PROJECT_ID=your-project-id bash deploy/setup-gcp.sh
```

The script asks for the PayPal values, hiding the secret as you type, or reads `PAYPAL_CLIENT_ID` and `PAYPAL_SECRET` from the environment. It enables the APIs, creates the database, the service accounts and the GitHub sign-in limited to this repo, stores the secrets, and starts the first deploy with the demo data. Creating the database takes several minutes. It is safe to re-run.

## After the first deploy

1. Open `<service url>/api/ready` and fix whatever it reports.
2. Register the PayPal webhook with the same sandbox app credentials (no dashboard login needed), then set the `PAYPAL_WEBHOOK_ID` repo variable and redeploy:

   ```bash
   TOKEN=$(curl -s -u "$PAYPAL_CLIENT_ID:$PAYPAL_SECRET" -d grant_type=client_credentials https://api-m.sandbox.paypal.com/v1/oauth2/token | jq -r .access_token)
   curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" https://api-m.sandbox.paypal.com/v1/notifications/webhooks -d '{
     "url": "<service url>/api/webhooks/paypal",
     "event_types": [
       {"name":"CHECKOUT.ORDER.APPROVED"},
       {"name":"PAYMENT.AUTHORIZATION.CREATED"},{"name":"PAYMENT.AUTHORIZATION.VOIDED"},
       {"name":"PAYMENT.CAPTURE.PENDING"},{"name":"PAYMENT.CAPTURE.COMPLETED"},
       {"name":"PAYMENT.CAPTURE.DECLINED"},{"name":"PAYMENT.CAPTURE.DENIED"},
       {"name":"PAYMENT.CAPTURE.REFUNDED"},{"name":"PAYMENT.CAPTURE.REVERSED"}
     ]}' | jq -r .id
   gh variable set PAYPAL_WEBHOOK_ID --body "<the id printed>"
   gh workflow run deploy.yml
   ```

   These nine events are the ones `src/lib/paypal/webhook.ts` reads. PayPal delivers only to port 443 and retries a failed delivery up to 25 times over 3 days. `GET .../v1/notifications/webhooks` with the same token lists what is registered.
3. Set the `PUBLIC_BASE_URL` repo variable to the service URL. The message channels need it (see below).

Settings belong in repo variables, never set by hand on the service: every deploy replaces the service's variables with the ones in `deploy.yml`, so a value set in the console disappears on the next push.

To reset the hosted demo data, run the **Deploy to Cloud Run** workflow by hand with **seed** ticked. A normal deploy never seeds, because seeding rebuilds the demo tender.

## Message channels (optional)

The in-app inbox needs none of this. A channel switches on only when all of its settings exist; `/api/ready` lists each as `channel_telegram` and `channel_whatsapp`.

**Create the Secret Manager secrets before the first deploy that contains this change.** `deploy.yml` maps them, and Cloud Run refuses to deploy a service whose secret does not exist. Put real values in; an empty or dummy value would make the channel look configured.

```bash
# Value on stdin, never on the command line. Project harvest-511117 here; use yours.
printf '%s' "<bot token from @BotFather>"   | gcloud secrets create fairbid-telegram-bot-token --data-file=- --project <project>
printf '%s' "$(openssl rand -hex 24)"       | gcloud secrets create fairbid-telegram-webhook-secret --data-file=- --project <project>
printf '%s' "<Twilio auth token>"           | gcloud secrets create fairbid-twilio-auth-token --data-file=- --project <project>
```

Then set the repo variables below and deploy.

**Telegram.** In Telegram, message @BotFather, send `/newbot`, and keep the token it prints. Set `TELEGRAM_BOT_USERNAME` (no @). After the deploy, register the webhook once, with the same token and webhook secret in your local `.env` and `PUBLIC_BASE_URL` set to the service URL:

```bash
npm run channels:telegram -- set
npm run channels:telegram -- info
```

**WhatsApp (Twilio sandbox).** Set `TWILIO_ACCOUNT_SID`, `TWILIO_WHATSAPP_FROM` (the sandbox number, for example `+14155238886`) and `CHANNEL_ALLOWLIST` (the E.164 numbers of the people who will link, separated by semicolons). In the Twilio console, Messaging, Try it out, Send a WhatsApp message, Sandbox settings: set "When a message comes in" to `<service url>/api/webhooks/whatsapp` with method POST. Each person joins the sandbox from their phone with the join phrase shown there. Twilio signs the exact URL, so `PUBLIC_BASE_URL` must be the service URL with no trailing slash and no path.

A seller then presses **Link** on the dashboard and sends the code from their chat. Twilio's sandbox accepts free text only within 24 hours of the seller's last message to it; a seller who has not written in a day will not get the question there (the inbox still has it), so send `link` or any message shortly before a demo.

## Turn on the AI roles

The roles run on Gemini through Vertex AI. The service signs in as its own service account (`roles/aiplatform.user`, granted by the setup script), so there is no key to store. `/api/ready` says which model is live. To turn the AI off, set the `AI_ENABLED` repo variable to `false` and redeploy: every role then answers from its scripted fixture.

## Seller agents

The four demo agents sign in to `/api/mcp` with the keys in the `fairbid-mcp-seller-keys` secret. On an open tender, the demo buyer's **Invite seller agents** button runs them inside the service; it is not offered to registered accounts. To run them from a terminal instead:

```bash
MCP_SELLER_KEYS="$(gcloud secrets versions access latest --secret=fairbid-mcp-seller-keys)" npm run bots -- --url <service url>/api/mcp
```

## Repo variables

| Variable | What it does |
|---|---|
| `PAYPAL_CLIENT_ID`, `SQL_CONNECTION` | Set by the setup script |
| `PAYPAL_WEBHOOK_ID` | Turns on PayPal webhooks. Without it they are rejected |
| `SELLER_D_PAYPAL_EMAIL` | Sari's sandbox business account, the payee of the demo award. Without it PayPal refuses the award. After setting it, run the deploy with **seed** ticked or press Reset demo |
| `PUBLIC_BASE_URL` | The service URL. Twilio signatures are checked against it, and the Telegram webhook script reads it |
| `TELEGRAM_BOT_USERNAME` | The bot's username, no @. Telegram is off while empty |
| `TWILIO_ACCOUNT_SID`, `TWILIO_WHATSAPP_FROM` | Twilio account and sandbox number. WhatsApp is off while either is empty |
| `CHANNEL_ALLOWLIST` | Numbers that may link WhatsApp, separated by semicolons. Empty means nobody |
| `AI_MODEL` | Gemini model for the AI roles. Empty means `gemini-3.8-flash` |
| `AI_ENABLED` | `false` turns the AI roles off. Empty means on |
| `MIN_INSTANCES` | `1` keeps one instance warm. Empty means scale to zero |

## Judging week

Judges may open the link at any hour, and a cold start makes the first page slow. From 12 Nov until results are out, set `MIN_INSTANCES` to `1` and redeploy. That costs about US$10 a month while it is on. Set it back to empty afterwards.

The service has CPU boost on for faster cold starts, at most 3 instances, and 40 requests per instance, so a burst cannot run up the bill or exhaust the database's connections.

Without a warm instance, open `/api/health` a minute before a demo. Do background work inside a request, because Cloud Run throttles the CPU once a response has finished.

## Stop paying for it

The database bills about US$10 a month even when nobody visits. Once judging is over:

```bash
gcloud sql instances delete fairbid-db --project your-project-id
gcloud run services delete fairbid --region asia-southeast1 --project your-project-id
```

Export the data first if anyone needs it. The image repository, secrets and service accounts cost nothing worth noting and can stay.
