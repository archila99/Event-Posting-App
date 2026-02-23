# Ticket Book

A full-stack ticket reservation and purchase system with roles (Admin, Artist, User), venues, time slots, events, and atomic capacity handling.

## Features

- **Admin**: Create/update/deactivate locations and time slots; cancel events; override event capacity; view all reservations and purchases; refund tickets; deactivate users; audit log. (Admin account is created via database seed only—not available at registration.)
- **Artist**: Create events (location, date, time slot, optional image); events go live when the slot is free; view my events.
- **User**: Browse approved events; reserve 1–2 tickets per event (10-minute hold); complete purchase (email verification at first registration, then one-click for verified users); view my reservations and tickets; comment on events.

## Tech Stack

- **Backend**: Node.js, Express, TypeScript, Prisma (PostgreSQL)
- **Frontend**: React, Vite, TypeScript, React Router, Tailwind CSS
- **Auth**: JWT; role-based access; 7-day persisted session; two-step registration (register → email with 6-digit code → verify → account created). Login only after email is verified.

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

From `backend/`: `npm run clear-auth` clears pending registrations and verification codes (does not delete users). Use Prisma Studio or SQL to remove test users.

## Seed Accounts

After running `npm run db:seed`:

| Role   | Email                 | Password    |
|--------|------------------------|------------|
| Admin  | admin@ticketbook.com   | password123 |
| Artist | artist@ticketbook.com  | password123 |
| User   | user@ticketbook.com    | password123 |

The seed also creates time slots (Slot A, Slot B) and locations (London Stadium, Cardiff Stadium). **Only User and Artist can be chosen when registering;** the single admin is created via seed.

## Environment

Backend reads `backend/.env`. Copy from `backend/.env.example`. Main variables:

- `DATABASE_URL` – PostgreSQL connection string, e.g. `postgresql://user:password@localhost:5432/ticket_book`
- `JWT_SECRET` – Secret for JWT signing (use a strong value in production)
- `JWT_EXPIRES_IN` – Session lifetime (default `7d` so users stay logged in; use `20m` for short sessions)
- `PORT` – Backend port (default `3001`)
- `RESERVATION_EXPIRY_MINUTES` – Reservation hold time (default `10`)

### Email

Verification and other emails use **SMTP** (e.g. Gmail).

- Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and optionally `EMAIL_FROM` in `backend/.env`.
- For Gmail: use an [App Password](https://myaccount.google.com/apppasswords) (not your normal password). Use `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`.

Users receive a 6-digit code by email and enter it on the verification screen; the code is not shown on the frontend. Resend is available after a 60-second cooldown. Optional: set `INCLUDE_DEV_CODE=true` in `backend/.env` to include the code in the register API response (e.g. for local testing when email does not arrive); the frontend never displays it.

## API Overview

- **Auth**: `POST /api/auth/register` (returns message; no user until verified), `POST /api/auth/verify-email` (email + code → user + token), `POST /api/auth/resend-verification-code`, `POST /api/auth/login`, `GET /api/auth/me`
- **Public**: `GET /api/locations`, `GET /api/time-slots`, `GET /api/events` (optional `?fromDate=`, `?status=`), `GET /api/events/:id`
- **Artist**: `POST /api/events`, `GET /api/events/my/requests`
- **User**: `POST /api/reservations`, `GET /api/reservations/my`, `POST /api/tickets/send-verification-code/:id`, `POST /api/tickets/purchase/:id`, `GET /api/tickets/my`
- **Comments**: `GET /api/events/:id/comments`, `POST /api/events/:id/comments`, `DELETE /api/events/:id/comments/:commentId`
- **Admin**: `GET/POST/PATCH/DELETE /api/locations`, `GET/POST/PATCH/DELETE /api/time-slots`, `GET /api/admin/events`, `POST /api/admin/events/:id/cancel`, `PATCH /api/admin/events/:id/capacity`, `GET /api/admin/reservations`, `GET /api/admin/purchases`, `POST /api/admin/tickets/:id/refund`, `GET /api/admin/audit`, `PATCH /api/admin/users/:id/deactivate`, `GET /api/users`

## Business Rules (summary)

- Max 2 tickets per user per event. Reservations expire after 10 minutes.
- Event capacity is fixed at creation (≤ location max); admin can override.
- Registration is two-step: submit email/name/password → receive 6-digit code by email → enter code to create account. Login only for verified users. Verified users can confirm purchase without a code for later reservations.
- Session is persisted for 7 days (configurable via `JWT_EXPIRES_IN`) so users stay logged in.
- Comments: users can reply to others’ comments but not to their own.

## Load testing (k6 + Grafana)

Concurrent load tests use [k6](https://k6.io/) with optional metrics in Grafana. See **[k6/README.md](k6/README.md)** for:

- Installing k6 and running `smoke.js` / `load.js`
- Sending results to Grafana (Grafana Cloud k6 or self-hosted InfluxDB + Grafana)
- Tuning VUs, duration, and thresholds

## Deploy to Google Cloud Run (push from local)

You can build and deploy in one step from your machine. The app runs as a single container (backend + frontend) on [Cloud Run](https://cloud.google.com/run).

### Prerequisites

- [Google Cloud SDK (gcloud)](https://cloud.google.com/sdk/docs/install) installed and logged in: `gcloud auth login`
- A Google Cloud project: `gcloud config set project YOUR_PROJECT_ID`
- APIs enabled: `gcloud services enable run.googleapis.com cloudbuild.googleapis.com`
- A **PostgreSQL database** (e.g. [Cloud SQL](https://cloud.google.com/sql/docs/postgres)) with a database created. Note the connection name or connection string for `DATABASE_URL`.

### Deploy from local

1. **Set environment variables for Cloud Run**  
   You will pass secrets/env at deploy time. Minimum:
   - `DATABASE_URL` – PostgreSQL URL (e.g. Cloud SQL: `postgresql://user:pass@/dbname?host=/cloudsql/CONNECTION_NAME` for Unix socket, or public IP URL).
   - `JWT_SECRET` – A strong random string for signing JWTs.

2. **Deploy (build on Google Cloud, then run)**  
   From the repo root:
   ```bash
   gcloud run deploy ticket-book \
     --source . \
     --region YOUR_REGION \
     --allow-unauthenticated \
     --set-env-vars "NODE_ENV=production" \
     --set-env-vars "JWT_SECRET=your-jwt-secret" \
     --set-env-vars "DATABASE_URL=postgresql://user:pass@host:5432/dbname"
   ```
   Replace `YOUR_REGION` (e.g. `us-central1`), `JWT_SECRET`, and `DATABASE_URL` with your values. For Cloud SQL with a private connection, use the [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/connect-run) or a connection string that Cloud Run supports (e.g. Unix socket with `/cloudsql/CONNECTION_NAME`).

3. **First-time database setup**  
   Run migrations and seed once (from your machine or Cloud Shell, with network access to the DB):
   ```bash
   cd backend && DATABASE_URL="your-production-db-url" npx prisma db push
   DATABASE_URL="your-production-db-url" npx prisma db seed
   ```
   Or use a one-off Cloud Run job / Cloud Build step that runs these commands against the same `DATABASE_URL`.

4. **Optional: use Secret Manager**  
   Store secrets in [Secret Manager](https://cloud.google.com/secret-manager), then reference them in Cloud Run:
   ```bash
   gcloud run deploy ticket-book --source . --region YOUR_REGION \
     --set-secrets "DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest"
   ```

After deployment, Cloud Run prints the service URL. Open it in a browser to use the app. The container listens on `PORT` (default 8080), which Cloud Run sets automatically.

### Example: deploy with project eventora (europe-west2 + Cloud SQL)

You have:

- **Project:** `eventora-ticketing-app`
- **Region:** `europe-west2`
- **Cloud SQL instance:** `eventora-postgres`
- **Database:** `eventora_db`

**1. Set your project and ensure APIs are enabled:**

```bash
gcloud config set project eventora-ticketing-app
gcloud services enable run.googleapis.com cloudbuild.googleapis.com sqladmin.googleapis.com
```

**2. Create a database user** (if you don’t have one yet) and note the password:

```bash
gcloud sql users set-password postgres --instance=eventora-postgres --password=YOUR_DB_PASSWORD
# Or create a dedicated user: gcloud sql users create YOUR_USER --instance=eventora-postgres --password=YOUR_PASSWORD
```

**3. Run schema and seed once** (use the instance’s public IP or connect via Cloud SQL Proxy). Get the instance IP:

```bash
gcloud sql instances describe eventora-postgres --format='value(ipAddresses[0].ipAddress)'
```

Then from your machine (with the IP above):

```bash
cd backend
DATABASE_URL="postgresql://postgres:YOUR_DB_PASSWORD@INSTANCE_IP:5432/eventora_db" npx prisma db push
DATABASE_URL="postgresql://postgres:YOUR_DB_PASSWORD@INSTANCE_IP:5432/eventora_db" npx prisma db seed
```

**4. Deploy to Cloud Run** (from repo root). Cloud Run connects to Cloud SQL via the Unix socket, so use this `DATABASE_URL` format:

```bash
gcloud run deploy ticket-book \
  --source . \
  --project eventora-ticketing-app \
  --region europe-west2 \
  --allow-unauthenticated \
  --add-cloudsql-instances eventora-ticketing-app:europe-west2:eventora-postgres \
  --set-env-vars "NODE_ENV=production" \
  --set-env-vars "JWT_SECRET=CHANGE_ME_STRONG_SECRET" \
  --set-env-vars "DATABASE_URL=postgresql://postgres:YOUR_DB_PASSWORD@/eventora_db?host=/cloudsql/eventora-ticketing-app:europe-west2:eventora-postgres"
```

Replace `YOUR_DB_PASSWORD` and `CHANGE_ME_STRONG_SECRET` with your real values. Optionally add `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` with `--set-env-vars` for production email.

When the deploy finishes, open the printed service URL in your browser.

**Or use the shell scripts (all-in-one from repo root):**

1. **One-time: create a secrets file** (not committed):
   ```bash
   cp .env.deploy.example .env.deploy
   # Edit .env.deploy and set DB_PASSWORD and JWT_SECRET (and optionally INSTANCE_IP for DB setup).
   ```

2. **One-time: apply schema and seed the database:**
   ```bash
   chmod +x deploy-db-setup.sh
   ./deploy-db-setup.sh
   ```
   This uses `INSTANCE_IP` from `.env.deploy` or auto-detects it.

3. **Deploy (or redeploy) to Cloud Run:**
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```
   Reads project, region, instance, and secrets from `.env.deploy` and runs `gcloud run deploy`.

## Pushing to GitHub

1. **Ensure nothing secret is committed**  
   `.gitignore` excludes `backend/.env`, `.env.deploy`, `.cursor/`, and build artifacts. Only `backend/.env.example` (and `.env.deploy.example` if present) should be in the repo — no real secrets.

2. **Initialize and push** (if the repo is not yet on GitHub):
   ```bash
   git init
   git add .
   git status   # confirm backend/.env does not appear
   git commit -m "Initial commit: Ticket Book app"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/Ticket_Book.git
   git push -u origin main
   ```
   Replace `YOUR_USERNAME` with your GitHub username (or your org and repo URL).

3. **After someone clones**  
   They run `cp backend/.env.example backend/.env`, set `DATABASE_URL` and `JWT_SECRET`, then `npm run db:push` and `npm run db:seed`.

## License

MIT (or add your preferred license.)
