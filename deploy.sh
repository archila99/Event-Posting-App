#!/usr/bin/env bash
# Deploy Ticket Book to Google Cloud Run (eventora example).
# Secrets via env or a local file: create .env.deploy (gitignored) with:
#   export DB_PASSWORD=...
#   export JWT_SECRET=...
# Then: ./deploy.sh
# Or: DB_PASSWORD=... JWT_SECRET=... ./deploy.sh

set -e

# Load secrets from a local file if present (do not commit .env.deploy)
if [ -f .env.deploy ]; then
  echo "Loading .env.deploy..."
  set -a
  # shellcheck source=/dev/null
  source .env.deploy
  set +a
fi

# Config (override with env or .env.deploy)
GCP_PROJECT="${GCP_PROJECT:-eventora-ticketing-app}"
GCP_REGION="${GCP_REGION:-europe-west2}"
CLOUD_SQL_INSTANCE="${CLOUD_SQL_INSTANCE:-eventora-postgres}"
DB_NAME="${DB_NAME:-eventora_db}"
DB_USER="${DB_USER:-postgres}"
SERVICE_NAME="${SERVICE_NAME:-ticket-book}"

# Required secrets (must be set)
if [ -z "${DB_PASSWORD}" ]; then
  echo "Error: DB_PASSWORD is not set. Set it in .env.deploy or: DB_PASSWORD=... ./deploy.sh"
  exit 1
fi
if [ -z "${JWT_SECRET}" ]; then
  echo "Error: JWT_SECRET is not set. Set it in .env.deploy or: JWT_SECRET=... ./deploy.sh"
  exit 1
fi

CONNECTION_NAME="${GCP_PROJECT}:${GCP_REGION}:${CLOUD_SQL_INSTANCE}"

# URL-encode password so special chars (@, :, /, etc.) don't break the connection string
urlencode() {
  local s="$1"
  local l=${#s}
  local o=""
  for ((i=0;i<l;i++)); do
    local c="${s:$i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) o+="$c" ;;
      *) printf -v h '%%%02X' "'$c"; o+="$h" ;;
    esac
  done
  printf '%s' "$o"
}
DB_PASS_ENCODED=$(urlencode "$DB_PASSWORD")
# Prisma requires a non-empty host; use localhost (ignored when using ?host= socket path)
DATABASE_URL_SOCKET="postgresql://${DB_USER}:${DB_PASS_ENCODED}@localhost/${DB_NAME}?host=/cloudsql/${CONNECTION_NAME}"

# Cloud Run URL for CORS (format: https://SERVICE-PROJECT_NUMBER.REGION.run.app)
PROJECT_NUMBER=$(gcloud projects describe "$GCP_PROJECT" --format='value(projectNumber)' 2>/dev/null || true)
FRONTEND_URL_TO_USE="${FRONTEND_URL:-}"
if [ -z "$FRONTEND_URL_TO_USE" ] && [ -n "$PROJECT_NUMBER" ]; then
  FRONTEND_URL_TO_USE="https://${SERVICE_NAME}-${PROJECT_NUMBER}.${GCP_REGION}.run.app"
fi

# Use env file (YAML) - Cloud Run expects map: KEY: value (per Cloud Run docs)
# Use single-quoted YAML for DATABASE_URL so colons (@, :, ?) aren't misinterpreted
ENV_FILE=$(mktemp).yaml
trap 'rm -f "$ENV_FILE"' EXIT
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/'; }
yaml_single() { local s="$1"; printf "'%s'" "${s//\'/\'\'}"; }
{
  echo 'NODE_ENV: production'
  printf 'JWT_SECRET: %s\n' "$(esc "$JWT_SECRET")"
  printf 'DATABASE_URL: %s\n' "$(yaml_single "$DATABASE_URL_SOCKET")"
  [ -n "${FRONTEND_URL_TO_USE}" ] && printf 'FRONTEND_URL: %s\n' "$(esc "$FRONTEND_URL_TO_USE")"
  [ -n "${SMTP_USER}" ] && printf 'SMTP_USER: %s\n' "$(esc "$SMTP_USER")"
  [ -n "${SMTP_PASS}" ] && printf 'SMTP_PASS: %s\n' "$(esc "$SMTP_PASS")"
  [ -n "${SMTP_HOST}" ] && printf 'SMTP_HOST: %s\n' "$(esc "$SMTP_HOST")"
  [ -n "${SMTP_PORT}" ] && printf 'SMTP_PORT: %s\n' "$(esc "$SMTP_PORT")"
  [ -n "${EMAIL_FROM}" ] && printf 'EMAIL_FROM: %s\n' "$(esc "$EMAIL_FROM")"
} > "$ENV_FILE"

echo "Project: $GCP_PROJECT | Region: $GCP_REGION | Instance: $CLOUD_SQL_INSTANCE"
echo "Enabling APIs..."
gcloud config set project "$GCP_PROJECT"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com sqladmin.googleapis.com --quiet

# Optional: set MIN_INSTANCES=1 in .env.deploy to keep one instance warm (avoids 503 on cold start)
EXTRA_FLAGS=()
[ -n "${MIN_INSTANCES}" ] && EXTRA_FLAGS+=(--min-instances="$MIN_INSTANCES")

echo "Deploying to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --project "$GCP_PROJECT" \
  --region "$GCP_REGION" \
  --allow-unauthenticated \
  --add-cloudsql-instances "$CONNECTION_NAME" \
  --env-vars-file "$ENV_FILE" \
  "${EXTRA_FLAGS[@]}"

echo "Done. Open the service URL above in your browser."
