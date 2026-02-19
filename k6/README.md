# Load testing Ticket Book with k6 and Grafana

This folder contains [k6](https://k6.io/) scripts to run **concurrent load tests** against the Ticket Book API. You can view results in the terminal, export to JSON/CSV, or send metrics to **Grafana** (Grafana Cloud k6 or self-hosted InfluxDB + Grafana).

## Prerequisites

- **k6** installed ([Install k6](https://grafana.com/docs/k6/latest/set-up/install-k6/)):
  - macOS: `brew install k6`
  - Windows: `choco install k6` or download from k6.io
  - Linux: see [official install guide](https://grafana.com/docs/k6/latest/set-up/install-k6/)
- **Backend running** (e.g. `npm run dev:backend` from repo root so API is at `http://localhost:3001`)
- **Database seeded** so you have at least one user (e.g. `user@ticketbook.com` / `password123`) and some events

## Quick start (terminal only)

1. Start the backend:
   ```bash
   npm run dev:backend
   ```

2. From the repo root, run a short smoke test (10 VUs for 10 seconds):
   ```bash
   k6 run -e BASE_URL=http://localhost:3001 k6/smoke.js
   ```

3. Run a load test with more concurrency (20 VUs for 30 seconds):
   ```bash
   k6 run -e BASE_URL=http://localhost:3001 k6/load.js
   ```

`BASE_URL` must point to your API (default in scripts: `http://localhost:3001`). Change it if your backend runs elsewhere (e.g. `http://127.0.0.1:3001` or a staging URL).

## Scripts overview

| Script       | Purpose |
|-------------|--------|
| `smoke.js`  | Light check: health, public events/locations, optional login. Good for “is the API up?”. |
| `load.js`   | Concurrent load: health, list events, login as USER, list events again, get event by id, list “my reservations”. Simulates multiple users. |

You can add more scenarios (e.g. create reservation, purchase) by copying `load.js` and extending it. Keep in mind: creating reservations consumes capacity and may conflict with other VUs.

## k6 options (duration, VUs, stages)

- **VUs** = virtual users (concurrent iterations).
- **Duration** = how long the test runs.

Examples:

```bash
# 5 VUs for 30 seconds
k6 run --vus 5 --duration 30s -e BASE_URL=http://localhost:3001 k6/load.js

# Ramp up: 0 → 10 VUs over 1m, hold 10 VUs for 2m, ramp down over 30s
k6 run --stage 1m:0,2m:10,30s:0 -e BASE_URL=http://localhost:3001 k6/load.js
```

Scripts use `__ENV.BASE_URL` so you can override with `-e BASE_URL=...`.

## Sending metrics to Grafana

You have two main options.

### Option A: Grafana Cloud k6 (easiest)

1. Sign up at [Grafana Cloud](https://grafana.com/products/cloud/) and get a **k6 Cloud** or **Grafana Cloud k6** token (see [Grafana Cloud k6 docs](https://grafana.com/docs/grafana-cloud/k6/get-started/)).
2. Run k6 and push results to the cloud:
   ```bash
   k6 run --out cloud -e BASE_URL=http://localhost:3001 k6/load.js
   ```
   When prompted, log in or use `K6_CLOUD_TOKEN` env var.
3. Open the link k6 prints (e.g. app.k6.io or Grafana Cloud) to see results and graphs.

### Option B: Self-hosted Grafana + InfluxDB

1. Run **InfluxDB** and **Grafana** (e.g. with Docker):
   ```bash
   docker run -d --name influxdb -p 8086:8086 influxdb:2
   docker run -d --name grafana -p 3000:3000 grafana/grafana
   ```
   Create an InfluxDB v2 bucket and a token with write access (port 8086).

2. Run k6 and send metrics to InfluxDB:
   ```bash
   k6 run --out influxdb=http://localhost:8086/ticketbook -e BASE_URL=http://localhost:3001 k6/load.js
   ```
   (InfluxDB v2 often needs: `--out "influxdb=http://localhost:8086?org=YOUR_ORG&token=YOUR_TOKEN"` — see [k6 InfluxDB output](https://grafana.com/docs/k6/latest/results-output/real-time/influxdb-1.x/).)

3. In Grafana, add **InfluxDB** as a data source (point to `http://influxdb:8086` or `http://localhost:8086` if Grafana runs on host). Import a k6 dashboard (e.g. from [Grafana dashboards](https://grafana.com/grafana/dashboards/) search “k6”) or build panels from the `k6_*` metrics.

For InfluxDB v1.x output, see [k6 docs](https://grafana.com/docs/k6/latest/results-output/real-time/influxdb-1.x/). For Prometheus remote write, see [k6 Prometheus](https://grafana.com/docs/k6/latest/results-output/real-time/prometheus-remote-write/).

## Environment variables

| Variable   | Used in scripts | Description |
|------------|------------------|-------------|
| `BASE_URL` | All              | API base URL (default `http://localhost:3001`). |
| `LOGIN_EMAIL` | `load.js`     | User email for auth (default seed user). |
| `LOGIN_PASSWORD` | `load.js`  | User password (default seed password). |

Example with custom user:

```bash
k6 run -e BASE_URL=http://localhost:3001 -e LOGIN_EMAIL=user@ticketbook.com -e LOGIN_PASSWORD=password123 k6/load.js
```

## What to look for in results

- **http_req_duration** – Response time (p95, p99). High values under load may indicate bottlenecks.
- **http_req_failed** – Failed request rate. Should be 0 or very low for a healthy run.
- **iterations** – Completed scenarios per VU. Throughput is related to iterations × VUs / duration.
- **vus** – Number of concurrent virtual users.

Use Grafana (or k6 Cloud) to graph these over time when you run longer or staged tests.

## Tips

- Run the backend and DB locally (or against a dedicated staging env). Avoid load testing production without limits.
- Start with low VUs (e.g. 5–10) and short duration, then increase.
- If you add scripts that create reservations or tickets, use unique test data (e.g. dedicated events or cleanup) to avoid conflicts between VUs.
