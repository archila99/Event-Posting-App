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
| Artist | artist@ticketbook.com  | password123 |
| User   | user@ticketbook.com    | password123 |

The seed also creates time slots (Slot A, Slot B) and locations (London Stadium, Cardiff Stadium). **Only User and Artist can be chosen when registering;** the single admin is created via seed.

## Environment

Backend reads `backend/.env` locally. Copy from `backend/.env.example`. For production deployment (Render + Vercel + Supabase), see `DEPLOYMENT.md`. Main variables:

- `DATABASE_URL` – PostgreSQL connection string (Supabase should include `?sslmode=require`)
- `DIRECT_URL` – Optional direct DB connection string for migrations (recommended with Supabase pooler)
- `JWT_ACCESS_SECRET` – Access token signing secret
- `JWT_REFRESH_SECRET` – Refresh token hashing/validation secret
- `ACCESS_TOKEN_EXPIRES_IN` – Access token lifetime (default `15m`)
- `REFRESH_TOKEN_EXPIRES_IN` – Refresh token lifetime (default `7d`)
- `PORT` – Backend port (default `3001`)
- `RESERVATION_EXPIRY_MINUTES` – Reservation hold time (default `10`)
- Uploads are stored under `backend/uploads/` and served at `/api/uploads/` by default (may be ephemeral in production hosts).

### OTP (no email delivery)

This app uses a **UI-based OTP** flow for verification in local development/demo mode (no SMTP/email required). After signup, the API returns an `otpPreview` which the frontend displays; you enter it to complete verification.

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
- Set `backend/.env` locally with `DATABASE_URL` and auth secrets (see `backend/.env.example`).
- For production deployment (Render + Vercel + Supabase), see `DEPLOYMENT.md`.

## Pushing to GitHub

The repo is set up to be safe to push: `.gitignore` excludes secrets, env files with credentials, build output, and IDE/OS cruft. Only template env files (e.g. `backend/.env.example`, `frontend/.env.example`) are committed.

1. **Before first push**  
   Ensure `backend/.env` is **not** staged (it contains secrets). Run `git status` and confirm it does not appear.

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
   Replace `YOUR_USERNAME` with your GitHub username or use your org/repo URL.

3. **After someone clones**  
   They run `cp backend/.env.example backend/.env`, set `DATABASE_URL` and `JWT_SECRET`, then `npm run db:push` and `npm run db:seed`.

