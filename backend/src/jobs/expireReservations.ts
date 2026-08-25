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

  const actuallyExpired: typeof expired = [];
  for (const r of expired) {
    const didExpire = await prisma.$transaction(async (tx) => {
      // Do not trust the candidate query; re-check under row lock.
      const locked = await tx.$queryRaw<Array<{ id: string; status: string; expiresAt: Date }>>`
        SELECT id, status, "expiresAt"
        FROM "Reservation"
        WHERE id = ${r.id}
        FOR UPDATE
      `;
      const row = locked[0];
      if (!row || row.status !== "ACTIVE") return false;
      if (!(new Date(row.expiresAt) < new Date())) return false;

      await tx.reservation.update({
        where: { id: r.id },
        data: { status: "EXPIRED" },
      });
      await tx.ticket.updateMany({
        where: { reservationId: r.id },
        data: { status: "EXPIRED" },
      });
      return true;
    });
    if (didExpire) actuallyExpired.push(r);
  }

  for (const r of actuallyExpired) {
    await auditLog("RESERVATION_EXPIRED", "Reservation", r.id, r.userId);
  }
}

export function startReservationExpiryJob() {
  setInterval(() => {
    expireReservations().catch((err) => console.error("[expireReservations]", err));
  }, INTERVAL_MS);
  expireReservations().catch((err) => console.error("[expireReservations] initial run", err));
}
