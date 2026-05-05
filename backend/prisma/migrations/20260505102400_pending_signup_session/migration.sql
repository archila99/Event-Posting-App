-- Create PendingSignupSession used for OTP-gated signup.
-- This migration is intentionally minimal and safe to run in production:
-- it only creates the missing table + indexes required by the new auth flow.

CREATE TABLE IF NOT EXISTS "PendingSignupSession" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "otpHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PendingSignupSession_pkey" PRIMARY KEY ("id")
);

-- Unique email (one active session per email via upsert).
CREATE UNIQUE INDEX IF NOT EXISTS "PendingSignupSession_email_key" ON "PendingSignupSession"("email");

-- Supporting indexes.
CREATE INDEX IF NOT EXISTS "PendingSignupSession_expiresAt_idx" ON "PendingSignupSession"("expiresAt");
CREATE INDEX IF NOT EXISTS "PendingSignupSession_email_createdAt_idx" ON "PendingSignupSession"("email", "createdAt");

