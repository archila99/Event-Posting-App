# Ticket Book

A full-stack ticket reservation and purchase system with roles (Admin, Artist, User), venues, time slots, events, and atomic capacity handling.

## Features

- **Admin**: Create/update/deactivate locations and time slots; cancel events; override event capacity; view all reservations and purchases; refund tickets; deactivate users; audit log. (Admin account is created via database seed only—not available at registration.)
- **Artist**: Create events (location, date, time slot, optional image); events go live when the slot is free; view my events.
- **User**: Browse approved events; reserve 1–2 tickets per event (10-minute hold); complete purchase (email verification at first registration, then one-click for verified users); view my reservations and tickets; comment on events.

## Tech Stack

- **Backend**: Node.js, Express, TypeScript, Prisma (SQLite)
- **Frontend**: React, Vite, TypeScript, React Router, Tailwind CSS
- **Auth**: JWT; role-based access; 20-minute session limit; one-time email verification at registration

## Prerequisites

- Node.js 18+
- npm (or yarn)

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

   Edit `backend/.env`. For local dev you can keep the default `DATABASE_URL="file:./dev.db"` and set `JWT_SECRET` to any string. Optional: set SMTP vars for verification/purchase emails (see [Email](#email) below).

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
| `npm run db:studio`   | Open Prisma Studio (run from `backend`) |

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

- `DATABASE_URL` – SQLite path, e.g. `file:./dev.db`
- `JWT_SECRET` – Secret for JWT signing (use a strong value in production)
- `JWT_EXPIRES_IN` – Session lifetime, e.g. `20m`, `1h`, `24h`
- `PORT` – Backend port (default `3001`)
- `RESERVATION_EXPIRY_MINUTES` – Reservation hold time (default `10`)

### Email

For verification and purchase emails, set SMTP variables in `backend/.env` (see `backend/.env.example`). Example for Gmail:

1. Use a [Gmail App Password](https://myaccount.google.com/apppasswords) (not your normal password).
2. Set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`.

If SMTP is not configured, the backend logs verification codes to the console so you can still complete flows in dev.

## API Overview

- **Auth**: `POST /api/auth/register` (role: USER or ARTIST), `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/verify-email`
- **Public**: `GET /api/locations`, `GET /api/time-slots`, `GET /api/events` (optional `?fromDate=`, `?status=`), `GET /api/events/:id`
- **Artist**: `POST /api/events`, `GET /api/events/my/requests`
- **User**: `POST /api/reservations`, `GET /api/reservations/my`, `POST /api/tickets/send-verification-code/:id`, `POST /api/tickets/purchase/:id`, `GET /api/tickets/my`
- **Comments**: `GET /api/events/:id/comments`, `POST /api/events/:id/comments`, `DELETE /api/events/:id/comments/:commentId`
- **Admin**: `GET/POST/PATCH/DELETE /api/locations`, `GET/POST/PATCH/DELETE /api/time-slots`, `GET /api/admin/events`, `POST /api/admin/events/:id/cancel`, `PATCH /api/admin/events/:id/capacity`, `GET /api/admin/reservations`, `GET /api/admin/purchases`, `POST /api/admin/tickets/:id/refund`, `GET /api/admin/audit`, `PATCH /api/admin/users/:id/deactivate`, `GET /api/users`

## Business Rules (summary)

- Max 2 tickets per user per event. Reservations expire after 10 minutes.
- Event capacity is fixed at creation (≤ location max); admin can override.
- Email is verified once at registration; verified users can confirm purchase without a code for later reservations.
- Session limit (e.g. 20 minutes) applies to all roles.

## License

MIT (or add your preferred license.)
