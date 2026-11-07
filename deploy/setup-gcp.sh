#!/usr/bin/env bash
# One-time Cloud Run setup. Run it from Google Cloud Shell, signed in to your own
# account, after `gh auth login`. Safe to re-run: every step skips what exists.
#
#   PROJECT_ID=your-project-id bash deploy/setup-gcp.sh
#
# It asks for the PayPal sandbox client id and secret and a Postgres URL. Those are
# stored in Secret Manager and GitHub secrets, and never printed.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID to the GCP project, with billing enabled}"
GITHUB_REPO="${GITHUB_REPO:-RaymonddC/fairbid}"
REGION="${REGION:-asia-southeast1}"

command -v gcloud >/dev/null || { echo "gcloud is required. Use Google Cloud Shell." >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first." >&2; exit 1; }

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUN_SA="fairbid-run@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="fairbid-deployer@${PROJECT_ID}.iam.gserviceaccount.com"

read -r -p "PayPal sandbox client id: " PAYPAL_CLIENT_ID
read -r -s -p "PayPal sandbox secret: " PAYPAL_SECRET; echo
read -r -s -p "Postgres URL (postgresql://...): " DATABASE_URL; echo

[ -n "$PAYPAL_CLIENT_ID" ] && [ -n "$PAYPAL_SECRET" ] || { echo "PayPal values are required." >&2; exit 1; }
case "$DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *) echo "The Postgres URL must start with postgres:// or postgresql://" >&2; exit 1 ;;
esac

echo "== Enabling APIs =="
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

echo "== Image repository =="
gcloud artifacts repositories describe fairbid --location="$REGION" >/dev/null 2>&1 ||
  gcloud artifacts repositories create fairbid --repository-format=docker --location="$REGION"

echo "== Service accounts =="
gcloud iam service-accounts describe "$RUN_SA" >/dev/null 2>&1 ||
  gcloud iam service-accounts create fairbid-run --display-name="FairBid runtime"
gcloud iam service-accounts describe "$DEPLOY_SA" >/dev/null 2>&1 ||
  gcloud iam service-accounts create fairbid-deployer --display-name="FairBid GitHub deployer"

for role in roles/run.admin roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${DEPLOY_SA}" --role="$role" --condition=None --quiet >/dev/null
done
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
put_secret fairbid-database-url "$DATABASE_URL"
put_secret fairbid-paypal-secret "$PAYPAL_SECRET"
# Kept across re-runs, so a second run does not sign everyone out.
gcloud secrets describe fairbid-session-secret >/dev/null 2>&1 ||
  put_secret fairbid-session-secret "$(openssl rand -base64 32)"

echo "== GitHub settings =="
gh secret set GCP_PROJECT_ID --repo "$GITHUB_REPO" --body "$PROJECT_ID"
gh secret set GCP_WORKLOAD_IDENTITY_PROVIDER --repo "$GITHUB_REPO" --body "${POOL}/providers/fairbid"
gh secret set GCP_DEPLOY_SA --repo "$GITHUB_REPO" --body "$DEPLOY_SA"
gh secret set MIGRATION_DATABASE_URL --repo "$GITHUB_REPO" --body "$DATABASE_URL"
gh variable set PAYPAL_CLIENT_ID --repo "$GITHUB_REPO" --body "$PAYPAL_CLIENT_ID"

echo "== First deploy, with the demo data =="
gh workflow run deploy.yml --repo "$GITHUB_REPO" -f seed=true

echo
echo "Done. Follow the deploy with:"
echo "  gh run watch --repo ${GITHUB_REPO}"
echo "The service URL is printed at the end of that run."
