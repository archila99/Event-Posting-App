-- Additive alignment: retain obsolete auth tables/columns and their data.
-- Legacy plaintext purchase codes are invalidated, not copied into a hash field.
-- No existing application database is migrated by the test runner.
BEGIN;
CREATE TABLE IF NOT EXISTS "OtpCode" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OtpCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "OtpCode_userId_createdAt_idx" ON "OtpCode"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "OtpCode_email_createdAt_idx" ON "OtpCode"("email", "createdAt");
CREATE INDEX IF NOT EXISTS "OtpCode_expiresAt_idx" ON "OtpCode"("expiresAt");
ALTER TABLE "VerificationCode" ADD COLUMN IF NOT EXISTS "codeHash" TEXT NOT NULL DEFAULT '!invalidated-legacy-code!';
ALTER TABLE "VerificationCode" ALTER COLUMN "codeHash" DROP DEFAULT;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'VerificationCode' AND column_name = 'code') THEN
    ALTER TABLE "VerificationCode" ALTER COLUMN "code" DROP NOT NULL;
  END IF;
END $$;

-- Fail on invalid legacy rows instead of silently repairing/deleting business data.
-- Review these invariants and any duplicates before applying outside a new test DB.
ALTER TABLE "Event" ADD CONSTRAINT "Event_capacity_positive" CHECK (capacity > 0);
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_quantity_range" CHECK (quantity BETWEEN 1 AND 2);
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_status_valid" CHECK (status IN ('ACTIVE', 'EXPIRED', 'CONVERTED'));
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_status_valid" CHECK (status IN ('RESERVED', 'SOLD', 'REFUNDED', 'EXPIRED'));
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_sold_owner" CHECK (status <> 'SOLD' OR ("userId" IS NOT NULL AND "purchasedAt" IS NOT NULL));
CREATE UNIQUE INDEX "Reservation_one_active_user_event" ON "Reservation"("eventId", "userId") WHERE status = 'ACTIVE';
CREATE INDEX "Reservation_status_expiresAt_idx" ON "Reservation"(status, "expiresAt");
CREATE INDEX "Reservation_eventId_userId_idx" ON "Reservation"("eventId", "userId");
CREATE INDEX "Ticket_eventId_status_idx" ON "Ticket"("eventId", status);
CREATE INDEX "Ticket_reservationId_idx" ON "Ticket"("reservationId");
CREATE INDEX "Ticket_userId_eventId_status_idx" ON "Ticket"("userId", "eventId", status);
COMMIT;
