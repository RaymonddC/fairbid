# Deploy

Pushes to `main` deploy to Cloud Run through `.github/workflows/deploy.yml`. Until the secrets below exist, the workflow skips cleanly.

## One-time setup

In the GCP project:

1. Enable Cloud Run, Artifact Registry, Secret Manager and IAM Credentials.
2. Create an Artifact Registry Docker repository named `fairbid` in `asia-southeast1`.
3. Create the runtime service account `fairbid-run`, with Secret Manager accessor on the secrets below.
4. Create a deploy service account, with Cloud Run admin, Artifact Registry writer, and service account user on `fairbid-run`. Allow this GitHub repo to impersonate it through Workload Identity Federation.
5. Add these Secret Manager secrets: `fairbid-database-url`, `fairbid-session-secret`, `fairbid-paypal-secret`.

In GitHub:

| Kind | Name | Value |
|---|---|---|
| Secret | `GCP_PROJECT_ID` | The project id |
| Secret | `GCP_WORKLOAD_IDENTITY_PROVIDER` | The provider resource name |
| Secret | `GCP_DEPLOY_SA` | The deploy service account email |
| Secret | `MIGRATION_DATABASE_URL` | A connection string that GitHub runners can reach |
| Variable | `PAYPAL_CLIENT_ID` | The sandbox client id. Not secret, and baked into the browser bundle |
| Variable | `PUBLIC_BASE_URL` | The service's public URL, with no trailing slash |

## After the first deploy

1. Run the workflow by hand with **seed** ticked. A normal deploy never seeds, because seeding rebuilds the demo tender.
2. Open `/api/ready` and fix whatever it reports.
3. Add a sandbox webhook pointing at `<public url>/api/webhooks/paypal`, then set `PAYPAL_WEBHOOK_ID`.

## Before a demo

The service scales to zero, so open `/api/health` a minute ahead to warm it. Do background work inside a request, because Cloud Run throttles the CPU once a response has finished.
