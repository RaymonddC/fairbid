# Deploy

The app runs on Google Cloud Run with a Cloud SQL Postgres database. Pushes to `main` deploy through `.github/workflows/deploy.yml`. Until setup is done, that workflow skips cleanly.

## One-time setup

You need:

- A GCP project of its own, with billing enabled
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

The database costs about US$10 a month even when nobody visits. Delete the `fairbid-db` instance once judging is over.

## After the first deploy

1. Open `<service url>/api/ready` and fix whatever it reports.
2. Add a sandbox webhook pointing at `<service url>/api/webhooks/paypal`, then set `PAYPAL_WEBHOOK_ID` on the service.
3. Set the `PUBLIC_BASE_URL` repo variable to the service URL. Twilio needs it, so it can wait until WhatsApp is on.

To reset the hosted demo data, run the **Deploy to Cloud Run** workflow by hand with **seed** ticked. A normal deploy never seeds, because seeding rebuilds the demo tender.

## Before a demo

The service scales to zero, so open `/api/health` a minute ahead to warm it. Do background work inside a request, because Cloud Run throttles the CPU once a response has finished.
