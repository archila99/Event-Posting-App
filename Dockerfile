# Ticket Book — production container (backend serves frontend static build)
# Build: docker build -t ticket-book .
# Run locally: docker run -p 3001:3001 -e DATABASE_URL=... -e JWT_ACCESS_SECRET=... -e JWT_REFRESH_SECRET=... ticket-book

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
FROM node:20-bullseye-slim AS production
WORKDIR /app/backend

# Backend runtime (copy lock so npm ci is reproducible)
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=backend /app/backend/dist ./dist
COPY backend/prisma ./prisma
RUN npx prisma generate

# Frontend static (served by Express in production)
COPY --from=frontend /app/frontend/dist ./public

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/index.js"]
