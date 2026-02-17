import { prisma } from "../lib/prisma.js";
import { auditLog } from "../lib/audit.js";

const INTERVAL_MS = 60 * 1000; // every minute

async function expireReservations() {
  const now = new Date();
  const expired = await prisma.reservation.findMany({
    where: { status: "ACTIVE", expiresAt: { lt: now } },
    select: { id: true, eventId: true, userId: true },
  });
  if (expired.length === 0) return;
  await prisma.$transaction(async (tx) => {
    for (const r of expired) {
      await tx.reservation.update({
        where: { id: r.id },
        data: { status: "EXPIRED" },
      });
      await tx.ticket.updateMany({
        where: { reservationId: r.id },
        data: { status: "EXPIRED" },
      });
    }
  });
  for (const r of expired) {
    await auditLog("RESERVATION_EXPIRED", "Reservation", r.id, r.userId);
  }
}

export function startReservationExpiryJob() {
  setInterval(expireReservations, INTERVAL_MS);
  expireReservations();
}
