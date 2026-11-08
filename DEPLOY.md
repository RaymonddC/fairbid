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
2. Add a sandbox webhook pointing at `<service url>/api/webhooks/paypal`, then set the `PAYPAL_WEBHOOK_ID` repo variable and redeploy.
3. Set the `PUBLIC_BASE_URL` repo variable to the service URL. Twilio needs it, so it can wait until WhatsApp is on.

Settings belong in repo variables, never set by hand on the service: every deploy replaces the service's variables with the ones in `deploy.yml`, so a value set in the console disappears on the next push.

To reset the hosted demo data, run the **Deploy to Cloud Run** workflow by hand with **seed** ticked. A normal deploy never seeds, because seeding rebuilds the demo tender.

## Turn on the AI roles

The roles run on Gemini through Vertex AI. The service signs in as its own service account (`roles/aiplatform.user`, granted by the setup script), so there is no key to store. `/api/ready` says which model is live. To turn the AI off, set the `AI_ENABLED` repo variable to `false` and redeploy: every role then answers from its scripted fixture.

## Seller agents

The four demo agents sign in to `/api/mcp` with the keys in the `fairbid-mcp-seller-keys` secret. On an open tender, the buyer's **Invite seller agents** button runs them inside the service. To run them from a terminal instead:

```bash
MCP_SELLER_KEYS="$(gcloud secrets versions access latest --secret=fairbid-mcp-seller-keys)" npm run bots -- --url <service url>/api/mcp
```

## Repo variables

| Variable | What it does |
|---|---|
| `PAYPAL_CLIENT_ID`, `SQL_CONNECTION` | Set by the setup script |
| `PAYPAL_WEBHOOK_ID` | Turns on PayPal webhooks. Without it they are rejected |
| `SELLER_D_PAYPAL_EMAIL` | Sari's sandbox business account, the payee of the demo award. Without it PayPal refuses the award. After setting it, run the deploy with **seed** ticked or press Reset demo |
| `PUBLIC_BASE_URL` | The service URL, for Twilio |
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
