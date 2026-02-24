#!/usr/bin/env bash
# One-time: run Prisma db push and seed against your Cloud SQL instance.
# If direct connection fails (P1001), use Cloud SQL Auth Proxy: set USE_PROXY=1 in .env.deploy
# and install https://cloud.google.com/sql/docs/postgres/connect-auth-proxy
# Or add your IP in GCP Console: SQL → your instance → Connections → Authorized networks.

set -e

if [ -f .env.deploy ]; then
  set -a
  # shellcheck source=/dev/null
  source .env.deploy
  set +a
fi

GCP_PROJECT="${GCP_PROJECT:-eventora-ticketing-app}"
GCP_REGION="${GCP_REGION:-europe-west2}"
CLOUD_SQL_INSTANCE="${CLOUD_SQL_INSTANCE:-eventora-postgres}"
DB_NAME="${DB_NAME:-eventora_db}"
DB_USER="${DB_USER:-postgres}"
PROXY_PORT="${PROXY_PORT:-5433}"

if [ -z "${DB_PASSWORD}" ]; then
  echo "Error: DB_PASSWORD is not set. Use .env.deploy or: DB_PASSWORD=... ./deploy-db-setup.sh"
  exit 1
fi
# If you get P1000 (auth failed): set postgres password on Cloud SQL to match DB_PASSWORD:
#   gcloud sql users set-password postgres --instance=$CLOUD_SQL_INSTANCE --project=$GCP_PROJECT --password=YOUR_PASSWORD

CONNECTION_NAME="${GCP_PROJECT}:${GCP_REGION}:${CLOUD_SQL_INSTANCE}"
PROXY_PID=""

cleanup_proxy() {
  if [ -n "$PROXY_PID" ] && kill -0 "$PROXY_PID" 2>/dev/null; then
    kill "$PROXY_PID" 2>/dev/null || true
    wait "$PROXY_PID" 2>/dev/null || true
  fi
}
trap cleanup_proxy EXIT

if [ "${USE_PROXY}" = "1" ] || [ "${USE_PROXY}" = "true" ]; then
  if ! command -v cloud_sql_proxy >/dev/null 2>&1; then
    echo "Error: USE_PROXY=1 but cloud_sql_proxy is not in PATH. Install it:"
    echo "  https://cloud.google.com/sql/docs/postgres/connect-auth-proxy"
    echo "  e.g. curl -o cloud_sql_proxy https://dl.google.com/cloudsql/cloud_sql_proxy.darwin.amd64 && chmod +x cloud_sql_proxy"
    exit 1
  fi
  echo "Starting Cloud SQL Auth Proxy on port $PROXY_PORT..."
  cloud_sql_proxy -instances="${CONNECTION_NAME}=tcp:${PROXY_PORT}" &
  PROXY_PID=$!
  sleep 3
  export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${PROXY_PORT}/${DB_NAME}"
else
  if [ -z "${INSTANCE_IP}" ]; then
    echo "Getting Cloud SQL instance IP..."
    INSTANCE_IP=$(gcloud sql instances describe "$CLOUD_SQL_INSTANCE" --project "$GCP_PROJECT" --format='value(ipAddresses[0].ipAddress)' 2>/dev/null || true)
  fi
  if [ -z "$INSTANCE_IP" ]; then
    echo "No public IP or USE_PROXY not set. To connect from this machine, either:"
    echo "  1. In GCP Console: SQL → $CLOUD_SQL_INSTANCE → Connections → Add your IP to Authorized networks"
    echo "  2. Or use Cloud SQL Auth Proxy: add USE_PROXY=1 to .env.deploy and install cloud_sql_proxy"
    echo "     https://cloud.google.com/sql/docs/postgres/connect-auth-proxy"
    exit 1
  fi
  echo "Using instance IP: $INSTANCE_IP"
  export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${INSTANCE_IP}:5432/${DB_NAME}"
fi

# Use a temp .env so Prisma ignores backend/.env (which has local DATABASE_URL)
TMP_ENV=$(mktemp)
trap 'cleanup_proxy; rm -f "$TMP_ENV"' EXIT
printf 'DATABASE_URL=%s\n' "$DATABASE_URL" > "$TMP_ENV"

echo "Running prisma db push..."
(cd backend && DOTENV_CONFIG_PATH="$TMP_ENV" npx prisma db push)
echo "Running prisma db seed..."
(cd backend && DOTENV_CONFIG_PATH="$TMP_ENV" npx prisma db seed)
echo "Database setup done."
