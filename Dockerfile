# Ticket Book — Google Cloud Run (single container: backend + frontend)
# Build: docker build -t ticket-book .
# Run locally: docker run -p 8080:8080 -e DATABASE_URL=... -e JWT_SECRET=... ticket-book

# ---- Frontend ----
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# ---- Backend build ----
FROM node:20-alpine AS backend
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci
COPY backend/ .
RUN npx prisma generate && npm run build

# ---- Production ----
# Use Bullseye (Debian 11) - has OpenSSL 1.1; Cloud Run runtime expects debian-openssl-1.1.x
FROM node:20-bullseye-slim AS production
WORKDIR /app/backend

# Backend runtime (copy lock so npm ci is reproducible)
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=backend /app/backend/dist ./dist
COPY backend/prisma ./prisma
# Generate Prisma client for Debian + OpenSSL 1.1 (Bullseye has libssl.so.1.1)
RUN sed -i 's/binaryTargets = .*/binaryTargets = ["debian-openssl-1.1.x"]/' prisma/schema.prisma && npx prisma generate

# Frontend static (served by Express in production)
COPY --from=frontend /app/frontend/dist ./public

# Cloud Run uses PORT (default 8080)
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/index.js"]
