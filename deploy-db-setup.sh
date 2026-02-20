#!/usr/bin/env bash
# One-time: run Prisma db push and seed against your Cloud SQL instance.
# Requires instance to be reachable (public IP or Cloud SQL Auth Proxy).
# Load secrets from .env.deploy if present, or set DB_PASSWORD (and optionally INSTANCE_IP).

set -e

if [ -f .env.deploy ]; then
  set -a
  # shellcheck source=/dev/null
  source .env.deploy
  set +a
fi

GCP_PROJECT="${GCP_PROJECT:-eventora-ticketing-app}"
CLOUD_SQL_INSTANCE="${CLOUD_SQL_INSTANCE:-eventora-postgres}"
DB_NAME="${DB_NAME:-eventora_db}"
DB_USER="${DB_USER:-postgres}"

if [ -z "${DB_PASSWORD}" ]; then
  echo "Error: DB_PASSWORD is not set. Use .env.deploy or: DB_PASSWORD=... ./deploy-db-setup.sh"
  exit 1
fi
# If you get P1000 (auth failed): set postgres password on Cloud SQL to match DB_PASSWORD:
#   gcloud sql users set-password postgres --instance=$CLOUD_SQL_INSTANCE --project=$GCP_PROJECT --password=YOUR_PASSWORD

if [ -z "${INSTANCE_IP}" ]; then
  echo "Getting Cloud SQL instance IP..."
  INSTANCE_IP=$(gcloud sql instances describe "$CLOUD_SQL_INSTANCE" --project "$GCP_PROJECT" --format='value(ipAddresses[0].ipAddress)')
  if [ -z "$INSTANCE_IP" ]; then
    echo "Error: Could not get instance IP. Set INSTANCE_IP in .env.deploy or ensure the instance has a public IP."
    exit 1
  fi
  echo "Using instance IP: $INSTANCE_IP"
fi

export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${INSTANCE_IP}:5432/${DB_NAME}"

# Use a temp .env so Prisma ignores backend/.env (which has local DATABASE_URL)
TMP_ENV=$(mktemp)
trap 'rm -f "$TMP_ENV"' EXIT
printf 'DATABASE_URL=%s\n' "$DATABASE_URL" > "$TMP_ENV"

echo "Running prisma db push..."
(cd backend && DOTENV_CONFIG_PATH="$TMP_ENV" npx prisma db push)
echo "Running prisma db seed..."
(cd backend && DOTENV_CONFIG_PATH="$TMP_ENV" npx prisma db seed)
echo "Database setup done."
