# Deploy

The app runs on Google Cloud Run. Pushes to `main` deploy through `.github/workflows/deploy.yml`. Until setup is done, that workflow skips cleanly.

## One-time setup

You need:

- A GCP project with billing enabled. Cloud Run requires billing even when usage stays inside the free tier
- A Postgres database reachable from the internet, for example a free [Neon](https://neon.tech) project
- The PayPal sandbox client id and secret

Open [Cloud Shell](https://shell.cloud.google.com) signed in to your own account, then run:

```bash
gh auth login
gh repo clone RaymonddC/fairbid
cd fairbid
PROJECT_ID=your-project-id bash deploy/setup-gcp.sh
```

The script asks for the three values and hides the secrets as you type. It enables the APIs, creates the service accounts and the GitHub sign-in limited to this repo, stores the secrets, and starts the first deploy with the demo data. It is safe to re-run.

## After the first deploy

1. Open `<service url>/api/ready` and fix whatever it reports.
2. Add a sandbox webhook pointing at `<service url>/api/webhooks/paypal`, then set `PAYPAL_WEBHOOK_ID` on the service.
3. Set the `PUBLIC_BASE_URL` repo variable to the service URL. Twilio needs it, so it can wait until WhatsApp is on.

To reset the hosted demo data, run the **Deploy to Cloud Run** workflow by hand with **seed** ticked. A normal deploy never seeds, because seeding rebuilds the demo tender.

## Before a demo

The service scales to zero, so open `/api/health` a minute ahead to warm it. Do background work inside a request, because Cloud Run throttles the CPU once a response has finished.
