#!/usr/bin/env bash
# One-time Cloud Run + Cloud SQL setup. Run it signed in to an account that owns
# the project, with `gh` signed in to GitHub. Safe to re-run: every step skips
# what exists.
#
#   PROJECT_ID=your-project-id bash deploy/setup-gcp.sh
#
# It asks for the PayPal sandbox client id and secret, or takes them from the
# PAYPAL_CLIENT_ID and PAYPAL_SECRET environment variables. They are stored in
# Secret Manager and GitHub secrets, and never printed.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID to the GCP project, with billing enabled}"
GITHUB_REPO="${GITHUB_REPO:-RaymonddC/fairbid}"
REGION="${REGION:-asia-southeast1}"
SQL_INSTANCE="${SQL_INSTANCE:-fairbid-db}"
SQL_TIER="${SQL_TIER:-db-f1-micro}"

command -v gcloud >/dev/null || { echo "gcloud is required." >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first." >&2; exit 1; }

# Scoped to this run, so the caller's gcloud defaults stay as they were.
export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"
export CLOUDSDK_BILLING_QUOTA_PROJECT="$PROJECT_ID"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUN_SA="fairbid-run@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="fairbid-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
SQL_CONNECTION="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"

[ -n "${PAYPAL_CLIENT_ID:-}" ] || read -r -p "PayPal sandbox client id: " PAYPAL_CLIENT_ID
[ -n "${PAYPAL_SECRET:-}" ] || { read -r -s -p "PayPal sandbox secret: " PAYPAL_SECRET; echo; }
[ -n "$PAYPAL_CLIENT_ID" ] && [ -n "$PAYPAL_SECRET" ] || { echo "PayPal values are required." >&2; exit 1; }

echo "== Enabling APIs =="
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  sqladmin.googleapis.com

echo "== Image repository =="
gcloud artifacts repositories describe fairbid --location="$REGION" >/dev/null 2>&1 ||
  gcloud artifacts repositories create fairbid --repository-format=docker --location="$REGION"

echo "== Service accounts =="
gcloud iam service-accounts describe "$RUN_SA" >/dev/null 2>&1 ||
  gcloud iam service-accounts create fairbid-run --display-name="FairBid runtime"
gcloud iam service-accounts describe "$DEPLOY_SA" >/dev/null 2>&1 ||
  gcloud iam service-accounts create fairbid-deployer --display-name="FairBid GitHub deployer"

# The deployer reaches the database through the Cloud SQL proxy to run migrations.
for role in roles/run.admin roles/artifactregistry.writer roles/cloudsql.client; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${DEPLOY_SA}" --role="$role" --condition=None --quiet >/dev/null
done
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUN_SA}" --role=roles/cloudsql.client --condition=None --quiet >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" \
  --member="serviceAccount:${DEPLOY_SA}" --role=roles/iam.serviceAccountUser --quiet >/dev/null

echo "== GitHub sign-in, limited to ${GITHUB_REPO} =="
gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"
gcloud iam workload-identity-pools providers describe fairbid \
  --location=global --workload-identity-pool=github >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools providers create-oidc fairbid \
    --location=global --workload-identity-pool=github \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}'"

POOL="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --member="principalSet://iam.googleapis.com/${POOL}/attribute.repository/${GITHUB_REPO}" \
  --role=roles/iam.workloadIdentityUser --quiet >/dev/null

echo "== Secrets =="
put_secret() {
  local name="$1" value="$2"
  gcloud secrets describe "$name" >/dev/null 2>&1 ||
    gcloud secrets create "$name" --replication-policy=automatic >/dev/null
  printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
  gcloud secrets add-iam-policy-binding "$name" \
    --member="serviceAccount:${RUN_SA}" --role=roles/secretmanager.secretAccessor --quiet >/dev/null
}
# Generated once and kept, so a re-run signs nobody out and keeps the database login.
gcloud secrets describe fairbid-session-secret >/dev/null 2>&1 ||
  put_secret fairbid-session-secret "$(openssl rand -base64 32)"
gcloud secrets describe fairbid-db-password >/dev/null 2>&1 ||
  put_secret fairbid-db-password "$(openssl rand -hex 24)"
DB_PASSWORD="$(gcloud secrets versions access latest --secret=fairbid-db-password)"
put_secret fairbid-paypal-secret "$PAYPAL_SECRET"
# Cloud Run reaches Cloud SQL over a unix socket that --add-cloudsql-instances mounts.
put_secret fairbid-database-url \
  "postgresql://fairbid:${DB_PASSWORD}@localhost/fairbid?host=/cloudsql/${SQL_CONNECTION}"

echo "== Database (first creation takes several minutes) =="
# Smallest shared-core Postgres. It has a public IP but no authorized networks,
# so only the Cloud SQL connector and proxy, which check IAM, can reach it.
gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1 ||
  gcloud sql instances create "$SQL_INSTANCE" --region="$REGION" \
    --database-version=POSTGRES_16 --edition=enterprise --tier="$SQL_TIER" \
    --storage-type=HDD --storage-size=10 --no-backup --quiet
gcloud sql databases describe fairbid --instance="$SQL_INSTANCE" >/dev/null 2>&1 ||
  gcloud sql databases create fairbid --instance="$SQL_INSTANCE"
if gcloud sql users list --instance="$SQL_INSTANCE" --format='value(name)' | grep -qx fairbid; then
  gcloud sql users set-password fairbid --instance="$SQL_INSTANCE" --password="$DB_PASSWORD" >/dev/null
else
  gcloud sql users create fairbid --instance="$SQL_INSTANCE" --password="$DB_PASSWORD" >/dev/null
fi

echo "== GitHub settings =="
gh secret set GCP_PROJECT_ID --repo "$GITHUB_REPO" --body "$PROJECT_ID"
gh secret set GCP_WORKLOAD_IDENTITY_PROVIDER --repo "$GITHUB_REPO" --body "${POOL}/providers/fairbid"
gh secret set GCP_DEPLOY_SA --repo "$GITHUB_REPO" --body "$DEPLOY_SA"
# Migrations run in CI through the Cloud SQL proxy on 127.0.0.1.
gh secret set MIGRATION_DATABASE_URL --repo "$GITHUB_REPO" \
  --body "postgresql://fairbid:${DB_PASSWORD}@127.0.0.1:5432/fairbid"
gh variable set PAYPAL_CLIENT_ID --repo "$GITHUB_REPO" --body "$PAYPAL_CLIENT_ID"
gh variable set SQL_CONNECTION --repo "$GITHUB_REPO" --body "$SQL_CONNECTION"

echo "== First deploy, with the demo data =="
gh workflow run deploy.yml --repo "$GITHUB_REPO" -f seed=true

echo
echo "Done. Follow the deploy with:"
echo "  gh run watch --repo ${GITHUB_REPO}"
echo "The service URL is printed at the end of that run."
