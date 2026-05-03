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
   - Prefer the Supabase **direct** Postgres connection string as `DATABASE_URL` on Render so `prisma migrate deploy` and the app share one URL (with `?sslmode=require`).
   - If you must use the **pooler** URL for the app, keep a direct URL for migrations (Prisma `directUrl` in `schema.prisma` + `DIRECT_URL` in env) per [Prisma + PgBouncer](https://www.prisma.io/docs/guides/performance-and-optimization/connection-management/configure-pg-bouncer).

Environment (backend):
- `DATABASE_URL="postgresql://...?...&sslmode=require"`
- `DIRECT_URL` — optional; only required if you add `directUrl = env("DIRECT_URL")` to `schema.prisma` for pooler setups.

---

## Backend on Render (Express + Prisma)

### Render service
Create a **Web Service** from this repo with:
- **Root directory**: `backend`
- **Runtime**: Node

### Build command
Install with dev dependencies so the Prisma CLI and TypeScript are available (`prisma` and `typescript` live in `devDependencies`):

```bash
npm ci --include=dev
```

Then either:

**Option A — migrations in one step (recommended)**  
Runs `generate`, applies all pending migrations to the DB Render injects via `DATABASE_URL`, then compiles:

```bash
npm run render-build
```

**Option B — split generate / build / migrate**

```bash
npx prisma generate
npm run build
```

…and use a Render **Pre-Deploy Command** (or a second build phase) for:

```bash
npm run db:migrate:deploy
```

### Start command
Use:

```bash
npm start
```

### Why you saw “table does not exist”
The database had **never received the full Prisma schema**. The repo used to ship only a small migration that created `RefreshToken` and referenced `"User"`, so `prisma migrate deploy` on an empty Supabase DB could not create `User`, `Reservation`, etc. The history is fixed with a **baseline migration** (`20250418100000_initial_schema`) that creates every table. After deploy, `_prisma_migrations` tracks applied files and the app matches the schema.

### Migrations (recommended)
- `npm run render-build` already runs `prisma migrate deploy` before `npm run build`.
- If you use Pre-Deploy instead, run `npm run db:migrate:deploy` there (`prisma migrate deploy`).

> **Local machine / one-off:** with `DATABASE_URL` pointing at Supabase (direct URL, `sslmode=require`), from `backend/`: `npx prisma migrate deploy` then optionally `npm run db:seed`.

> If your database was created only with `prisma db push` and you are switching to Migrate, resolve conflicts with [Prisma baselining](https://www.prisma.io/docs/guides/migrate/developing-with-prisma-migrate/baselining). Fresh Supabase DBs: run `migrate deploy` once.

### If you already applied the old `add_refresh_token` migration locally
That folder was removed and folded into `initial_schema`. On a **dev** DB that only has `_prisma_migrations` entries for the old name, reset the dev database or align `_prisma_migrations` with Prisma’s docs; production Supabase that never had tables should simply run the new `initial_schema` migration.

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

