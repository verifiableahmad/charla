#!/usr/bin/env bash
# Builds the Dockerfile with Cloud Build and deploys it to Cloud Run, wired to Cloud SQL (Postgres).
# One-time setup (see bottom of file) must be done first.
set -euo pipefail

PROJECT="${GCP_PROJECT:?set GCP_PROJECT}"
REGION="${GCP_REGION:-us-east4}"
SERVICE="${GCP_SERVICE:-charla}"
SQL_INSTANCE="${GCP_SQL_INSTANCE:-charla-db}"

gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --source . \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --min-instances 0 \
  --add-cloudsql-instances "$PROJECT:$REGION:$SQL_INSTANCE" \
  --set-env-vars "NODE_ENV=production,GOOGLE_REDIRECT_URI=${GOOGLE_REDIRECT_URI:?set GOOGLE_REDIRECT_URI to https://<service-url>/api/auth/google/callback}" \
  --set-secrets "DATABASE_URL=charla-database-url:latest,KEY_ENCRYPTION_SECRET=charla-key-encryption-secret:latest,GOOGLE_CLIENT_ID=charla-google-client-id:latest,GOOGLE_CLIENT_SECRET=charla-google-client-secret:latest,GEMINI_API_KEY=charla-gemini-api-key:latest"

# One-time setup:
#   gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
#   gcloud sql instances create charla-db --database-version=POSTGRES_16 --tier=db-f1-micro --region=$GCP_REGION
#   gcloud sql databases create charla --instance=charla-db
#   gcloud sql users create charla --instance=charla-db --password=<pw>
#   printf 'postgres://charla:<pw>@/charla?host=/cloudsql/<project>:<region>:charla-db' | gcloud secrets create charla-database-url --data-file=-
#   (repeat `gcloud secrets create` for the other secrets above)
#   Grant the Cloud Run service account roles/secretmanager.secretAccessor and roles/cloudsql.client.
