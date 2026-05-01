### Deployment overview

This repo is a monorepo:
- **Backend**: `backend/` (Render Web Service)
- **Frontend**: `frontend/` (Vercel)
- **Database**: Supabase Postgres (Prisma)

Auth uses:
- **Access token** (JWT, short-lived) stored in frontend `localStorage`
- **Refresh token** stored in an **HttpOnly cookie** set by the backend and used by `POST /api/auth/refresh`

No routes or business logic are changed for deployment.

---

## Supabase (Postgres) setup

1. Create a Supabase project and get a Postgres connection string.
2. Use **SSL required**:
   - Ensure your `DATABASE_URL` includes `?sslmode=require`.

3. Pooling / migrations:
   - If you use the Supabase **pooler (PgBouncer)** connection string for runtime, put that in `DATABASE_URL`.
   - Put the **direct** connection string in `DIRECT_URL` so Prisma migrations can run reliably.

Environment (backend):
- `DATABASE_URL="postgresql://...?...&sslmode=require"`
- `DIRECT_URL="postgresql://...?...&sslmode=require"` (recommended)

---

## Backend on Render (Express + Prisma)

### Render service
Create a **Web Service** from this repo with:
- **Root directory**: `backend`
- **Runtime**: Node

### Build command
Use:

```bash
npm ci
npx prisma generate
npm run build
```

### Start command
Use:

```bash
npm start
```

### Migrations (recommended)
Render supports a “Pre-Deploy Command”. Set it to:

```bash
npm run db:migrate:deploy
```

This runs:
- `prisma migrate deploy`

> Note: If your database was previously created with `prisma db push`, you may need to baseline once using Prisma’s recommended workflow. For a fresh Supabase DB, `migrate deploy` works normally.

### Required environment variables (Render)

- **Database**
  - `DATABASE_URL` (Supabase, include `sslmode=require`)
  - `DIRECT_URL` (optional but recommended)

- **CORS**
  - `FRONTEND_URL` = `https://<your-vercel-domain>`

- **Auth**
  - `JWT_ACCESS_SECRET` (required in production)
  - `JWT_REFRESH_SECRET` (required in production)
  - `ACCESS_TOKEN_EXPIRES_IN` = `15m`
  - `REFRESH_TOKEN_EXPIRES_IN` = `7d`

- **Email (SMTP)** (if you want email verification + purchase codes to send)
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`

- **Node**
  - `NODE_ENV=production`

### Cookie + CORS behavior (critical)
In production:
- Refresh cookie is set with `SameSite=None; Secure; HttpOnly`
- CORS uses `origin: FRONTEND_URL` and `credentials: true`

This is required for Vercel (frontend) ↔ Render (backend) cross-site refresh cookies.

---

## Frontend on Vercel (Vite React)

### Vercel project
Create a Vercel project from this repo with:
- **Root directory**: `frontend`

### Build settings
- Build command: `npm ci && npm run build`
- Output: Vercel auto-detects Vite (`dist/`)

### Environment variables (Vercel)
- `VITE_API_URL` = `https://<your-render-backend-domain>`

The frontend builds API URLs like:
- `${VITE_API_URL}/api/...`

All API requests include `credentials: "include"` so the refresh cookie can be sent.

---

## File uploads (event images)

Uploads route stays the same:
- `POST /api/upload`
- static serving: `/api/uploads/...`

Current behavior:
- **Development**: stores images on local disk under backend `uploads/`
- **Production**: uses local disk by default (may be ephemeral on many hosts)

If you deploy on Render, local disk is **ephemeral** (images can disappear on redeploy). For production persistence, configure an external storage provider (e.g. Supabase Storage) while keeping the same upload routes.

---

## Background job (reservation expiry)

Reservation expiry runs via an interval started by the server process. On Render Web Service, it runs as long as the service is running.

No cron dependency is required.

