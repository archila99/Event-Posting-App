import { prisma } from "../lib/prisma.js";
import { expireReservation } from "../services/bookingService.js";

const INTERVAL_MS = 60 * 1000; // every minute

export async function expireReservations() {
  // Bounded batch, using the same database clock as purchase. Other workers may
  // discover these candidates too; the service re-checks under the event lock.
  const expired = await prisma.$queryRaw<Array<{ id: string; eventId: string }>>`
    SELECT id, "eventId" FROM "Reservation"
    WHERE status = 'ACTIVE' AND "expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC')
    ORDER BY "expiresAt", id LIMIT 200`;
  let count = 0;
  for (const row of expired) {
    try { if (await expireReservation(row.id, row.eventId)) count++; }
    catch { console.error("[expireReservations] candidate failed; will retry on the next run", row.id); }
  }
  return count;
}

export function startReservationExpiryJob() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await expireReservations(); }
    catch { console.error("[expireReservations] scan failed; will retry on the next run"); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void run(); }, INTERVAL_MS);
  void run();
  return () => clearInterval(timer);
}
