# Ticket Book

A full-stack ticket reservation and purchase system with roles (Admin, Artist, User), venues, time slots, events, and atomic capacity handling. Ready to clone, configure, and push to GitHub.

## Features

- **Admin**: Create/update/deactivate locations and time slots; cancel events (deletes event and frees the slot for a new one); override event capacity; view all reservations and purchases; refund tickets; deactivate users; audit log. (Admin account is created via database seed only—not available at registration.)
- **Artist**: Create events (location, date, time slot, optional image); events go live when the slot is free; view my events.
- **User**: Browse approved events; reserve 1–2 tickets per event (10-minute hold); complete purchase (email verification at first registration, then one-click for verified users); view my reservations and tickets; comment on events.

## Tech Stack

- **Backend**: Node.js, Express, TypeScript, Prisma (PostgreSQL)
- **Frontend**: React, Vite, TypeScript, React Router, Tailwind CSS
- **Auth**: JWT; role-based access; 20-minute session (then re-login); two-step registration (register → email code → verify → account created); forgot password (email code → set new password). Login only after email is verified.

## Prerequisites

- Node.js 18+
- npm (or yarn)
- PostgreSQL (create a database, e.g. `ticket_book`, and set `DATABASE_URL` in `backend/.env`)

## Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/YOUR_USERNAME/Ticket_Book.git
   cd Ticket_Book
   ```
   Replace `YOUR_USERNAME` with the repo owner (or use the clone URL from GitHub).

2. **Install dependencies**

   ```bash
   npm install
   ```

   This runs `postinstall` and installs backend and frontend dependencies.

3. **Configure environment**

   Copy the backend example env and set your values (at least `DATABASE_URL` and `JWT_SECRET`):

   ```bash
   cp backend/.env.example backend/.env
   ```

   Edit `backend/.env`. Set `DATABASE_URL` to your PostgreSQL connection string (see [Environment](#environment)) and `JWT_SECRET`. Optional: set SMTP vars for verification/purchase emails (see [Email](#email) below).

4. **Create database and seed**

   ```bash
   npm run db:push
   npm run db:seed
   ```

5. **Run the app**

   ```bash
   npm run dev
   ```

   - Backend: [http://localhost:3001](http://localhost:3001)  
   - Frontend: [http://localhost:5173](http://localhost:5173)

   Open the frontend URL in your browser.

## Scripts (from repo root)

| Command            | Description                          |
|--------------------|--------------------------------------|
| `npm run dev`      | Start backend + frontend together    |
| `npm run dev:backend`  | Start backend only (port 3001)  |
| `npm run dev:frontend` | Start frontend only (port 5173) |
| `npm run build`    | Build backend and frontend           |
| `npm run db:push`  | Apply Prisma schema to DB            |
| `npm run db:seed`  | Seed admin, artist, user, slots, locations |
| `npm run db:studio`   | Open Prisma Studio (DB GUI)             |

From `backend/`: `npm run clear-auth` clears pending registrations, verification codes, and password-reset requests (does not delete users). Use Prisma Studio or SQL to remove test users.

## Seed Accounts

After running `npm run db:seed`:

| Role   | Email                 | Password    |
|--------|------------------------|------------|
| Admin  | admin@ticketbook.com   | password123 |
| Artist | artist@ticketbook.com  | password123 |
| User   | user@ticketbook.com    | password123 |

The seed also creates time slots (Slot A, Slot B) and locations (London Stadium, Cardiff Stadium). **Only User and Artist can be chosen when registering;** the single admin is created via seed.

## Environment

Backend reads `backend/.env` locally. Copy from `backend/.env.example`. For Cloud Run, use `.env.deploy` and `deploy.sh` (see [Deploy to Google Cloud Run](#deploy-to-google-cloud-run)). Main variables:

- `DATABASE_URL` – PostgreSQL connection string, e.g. `postgresql://user:password@localhost:5432/ticket_book`
- `JWT_SECRET` – Secret for JWT signing (use a strong value in production)
- `JWT_EXPIRES_IN` – Token/session lifetime (default `20m`; user must log in again after it expires; use `7d` for longer sessions)
- `PORT` – Backend port (default `3001`)
- `RESERVATION_EXPIRY_MINUTES` – Reservation hold time (default `10`)
- `GCS_BUCKET` – (Optional) Google Cloud Storage bucket name for event images. If set, uploads go to GCS (bucket stays **private**); the API serves images via a proxy route (`/api/events/:id/image`) so the frontend can display them without making the bucket public. Otherwise files are saved under `backend/uploads/` and served at `/api/uploads/`. On Cloud Run, set this so images persist across deploys.

### Email

Verification and other emails use **SMTP** (e.g. Gmail).

- Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and optionally `EMAIL_FROM` in `backend/.env`.
- For Gmail: use an [App Password](https://myaccount.google.com/apppasswords) (not your normal password). Use `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`.

Users receive a 6-digit code by email and enter it on the verification screen; the code is not shown on the frontend. Resend is available after a 60-second cooldown. Optional: set `INCLUDE_DEV_CODE=true` in `backend/.env` to include the code in the register API response (e.g. for local testing when email does not arrive); the frontend never displays it.

## API Overview

- **Auth**: `POST /api/auth/register`, `POST /api/auth/verify-email`, `POST /api/auth/resend-verification-code`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`
- **Public**: `GET /api/locations`, `GET /api/time-slots`, `GET /api/events` (optional `?fromDate=`, `?status=`), `GET /api/events/:id`
- **Artist**: `POST /api/events`, `GET /api/events/my/requests`
- **User**: `POST /api/reservations`, `GET /api/reservations/my`, `POST /api/tickets/send-verification-code/:id`, `POST /api/tickets/purchase/:id`, `GET /api/tickets/my`
- **Comments**: `GET /api/events/:id/comments`, `POST /api/events/:id/comments`, `DELETE /api/events/:id/comments/:commentId`
- **Admin**: `GET/POST/PATCH/DELETE /api/locations`, `GET/POST/PATCH/DELETE /api/time-slots`, `GET /api/admin/events`, `POST /api/admin/events/:id/cancel`, `PATCH /api/admin/events/:id/capacity`, `GET /api/admin/reservations`, `GET /api/admin/purchases`, `POST /api/admin/tickets/:id/refund`, `GET /api/admin/audit`, `PATCH /api/admin/users/:id/deactivate`, `GET /api/users`

## Business Rules (summary)

- Max 2 tickets per user per event. Reservations expire after 10 minutes.
- Event capacity is fixed at creation (≤ location max); admin can override.
- Registration is two-step: submit email/name/password → receive 6-digit code by email → enter code to create account. Login only for verified users. Verified users can confirm purchase without a code for later reservations.
- Session lasts 20 minutes by default (configurable via `JWT_EXPIRES_IN`); after that the user must log in again.
- Forgot password: user enters email → receives 6-digit code → enters code and new password → password is updated; then they log in with the new password.
- Comments: users can reply to others’ comments but not to their own.
- Admin cancel: the event is deleted from the database (reservations and tickets for it are removed), so the slot is free for a new event.

## Load testing (k6 + Grafana)

Concurrent load tests use [k6](https://k6.io/) with optional metrics in Grafana. See **[k6/README.md](k6/README.md)** for:

- Installing k6 and running `smoke.js` / `load.js`
- Sending results to Grafana (Grafana Cloud k6 or self-hosted InfluxDB + Grafana)
- Tuning VUs, duration, and thresholds

## Deployment checklist (before first deploy)

- Run `npm run db:push` (and `npm run db:seed` if needed) so the database has all tables, including `PendingRegistration` and `PendingPasswordReset`.
- Set `backend/.env` locally (and `.env.deploy` for Cloud Run) with `DATABASE_URL`, `JWT_SECRET`, and SMTP vars if you need email.
- For Cloud Run: run `./deploy-db-setup.sh` once so Cloud SQL has the schema and seed; then `./deploy.sh`.

## Deploy to Google Cloud Run

The app runs as a single container (backend + frontend) on [Cloud Run](https://cloud.google.com/run). **Same behaviour as local**: 20‑minute session, email verification, forgot password, reservations, SMTP. Use `deploy.sh` and `.env.deploy` for a one-command deploy.

### Prerequisites

- [Google Cloud SDK (gcloud)](https://cloud.google.com/sdk/docs/install) installed and logged in: `gcloud auth login`
- A Google Cloud project and a **Cloud SQL for PostgreSQL** instance with a database created (e.g. `eventora_db`)
- Database user and password (e.g. set via `gcloud sql users set-password postgres --instance=INSTANCE --password=...`)

### 1. One-time: create deploy config

```bash
cp .env.deploy.example .env.deploy
```

Edit `.env.deploy` and set at least:

- **`DB_PASSWORD`** – PostgreSQL user password for Cloud SQL
- **`JWT_SECRET`** – Strong random string (e.g. 32+ chars)

Optionally set `GCP_PROJECT`, `GCP_REGION`, `CLOUD_SQL_INSTANCE`, `DB_NAME`, `DB_USER`, `SERVICE_NAME` (defaults are in the file). **For verification emails on Cloud Run** you must set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` in `.env.deploy` (Cloud Run does not use `backend/.env`); use the same values as in your local `backend/.env`, then run `./deploy.sh` again. For same behaviour as local you can set `JWT_EXPIRES_IN=20m` and `RESERVATION_EXPIRY_MINUTES=10` (these are the script defaults if omitted).

### 2. One-time: database schema and seed

From repo root (with `.env.deploy` loaded, `DB_PASSWORD` set):

```bash
chmod +x deploy-db-setup.sh
./deploy-db-setup.sh
```

This runs `prisma db push` and `prisma db seed` against your Cloud SQL instance (uses public IP from `gcloud` if `INSTANCE_IP` is not set). If you get **P1001 (Can't reach database server)**, add your IP in GCP Console under SQL → your instance → **Connections → Authorized networks**, or set **`USE_PROXY=1`** in `.env.deploy` and install [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/connect-auth-proxy); the script will then connect via the proxy.

### 3. Deploy (or redeploy)

```bash
chmod +x deploy.sh
./deploy.sh
```

`deploy.sh` builds `DATABASE_URL` for Cloud SQL Unix socket, enables APIs, and runs `gcloud run deploy --source .` with env vars from `.env.deploy`. It passes `NODE_ENV=production`, `JWT_SECRET`, `DATABASE_URL`, `JWT_EXPIRES_IN` (default `20m`), `RESERVATION_EXPIRY_MINUTES` (default `10`), and optional `FRONTEND_URL`, SMTP vars. Cloud Run sets `PORT` (8080) automatically. After deploy, open the service URL in your browser; the app works the same as local (register, verify email, login, forgot password, reservations, SMTP when configured).

### Optional

- **Keep one instance warm** (avoid cold-start 503): in `.env.deploy` set `MIN_INSTANCES=1`.
- **Event images on Cloud Run**: Keep your bucket **private**. Set `GCS_BUCKET=your-bucket-name` in `.env.deploy` and redeploy. Grant the Cloud Run service account **Storage Object Admin** on the bucket. The API serves images via `/api/events/:id/image` (proxy), so the frontend displays `event.imageUrl` in event cards without exposing the bucket.
- **Manual deploy** (without `deploy.sh`): pass env vars with `gcloud run deploy ... --set-env-vars` or `--env-vars-file`. Use `--add-cloudsql-instances PROJECT:REGION:INSTANCE` and `DATABASE_URL` with `?host=/cloudsql/PROJECT:REGION:INSTANCE`.
- **Secret Manager**: store `DATABASE_URL` and `JWT_SECRET` in Secret Manager and use `--set-secrets` instead of env vars.

## Pushing to GitHub

The repo is set up to be safe to push: `.gitignore` excludes secrets, env files with credentials, build output, and IDE/OS cruft. Only template env files (e.g. `backend/.env.example`, `.env.deploy.example`) are committed.

1. **Before first push**  
   Ensure `backend/.env` and `.env.deploy` are **not** staged (they contain secrets). Run `git status` and confirm they do not appear.

2. **Initialize and push** (if the repo is not yet on GitHub):
   ```bash
   git init
   git add .
   git status   # confirm backend/.env and .env.deploy do not appear
   git commit -m "Initial commit: Ticket Book app"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/Ticket_Book.git
   git push -u origin main
   ```
   Replace `YOUR_USERNAME` with your GitHub username or use your org/repo URL.

3. **After someone clones**  
   They run `cp backend/.env.example backend/.env`, set `DATABASE_URL` and `JWT_SECRET`, then `npm run db:push` and `npm run db:seed`.

