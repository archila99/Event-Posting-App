import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { auditLog } from "../lib/audit.js";
import { BookingError, bookingTransaction, databaseNow, lockEvent } from "../lib/bookingTransaction.js";
import { MAX_TICKETS_PER_USER_PER_EVENT, MIN_TICKETS_PER_RESERVATION, RESERVATION_EXPIRY_MINUTES } from "../constants.js";

// All booking writers use Event -> Reservation (id order for batches) -> Ticket.
// Reads before the Event lock are discovery only; state is re-read after acquiring it.
const occupied = ["RESERVED", "SOLD"];

async function lockReservation(tx: Prisma.TransactionClient, id: string) {
  const [row] = await tx.$queryRaw<Array<{ id: string; eventId: string; userId: string; status: string; expiresAt: Date; quantity: number }>>`
    SELECT id, "eventId", "userId", status, "expiresAt", quantity FROM "Reservation" WHERE id = ${id} FOR UPDATE`;
  return row;
}

async function expireLocked(tx: Prisma.TransactionClient, row: { id: string; userId: string }) {
  await tx.reservation.update({ where: { id: row.id }, data: { status: "EXPIRED" } });
  await tx.ticket.updateMany({ where: { reservationId: row.id, status: "RESERVED" }, data: { status: "EXPIRED" } });
  await tx.verificationCode.deleteMany({ where: { reservationId: row.id } });
  await auditLog("RESERVATION_EXPIRED", "Reservation", row.id, row.userId, undefined, tx);
}

export async function createReservation(eventId: string, userId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < MIN_TICKETS_PER_RESERVATION || quantity > MAX_TICKETS_PER_USER_PER_EVENT) {
    throw new BookingError(400, "Quantity must be one or two tickets");
  }
  return bookingTransaction(async tx => {
    const event = await lockEvent(tx, eventId);
    if (event.status !== "APPROVED") throw new BookingError(400, `Event is not open for reservations (status: ${event.status}). Only approved events can be reserved.`);
    const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, deletedAt: true, emailVerifiedAt: true } });
    if (!user || user.deletedAt || user.role !== "USER") throw new BookingError(403, "Only user accounts can reserve tickets. Artists and admins can view events only.");
    if (!user.emailVerifiedAt) throw new BookingError(403, "Email verification required");
    const existing = await tx.reservation.findFirst({ where: { eventId, userId, status: "ACTIVE" } });
    if (existing) throw new BookingError(400, "You already have an active reservation for this event");
    const userTotal = await tx.ticket.count({ where: { eventId, status: { in: occupied }, OR: [{ userId }, { reservation: { userId } }] } });
    if (userTotal + quantity > MAX_TICKETS_PER_USER_PER_EVENT) {
      throw new BookingError(400, `Maximum ${MAX_TICKETS_PER_USER_PER_EVENT} tickets per user per event. You have ${userTotal} reserved or sold.`);
    }
    const taken = await tx.ticket.count({ where: { eventId, status: { in: occupied } } });
    if (taken + quantity > event.capacity) throw new BookingError(409, "Not enough tickets available");
    const now = await databaseNow(tx);
    const expiresAt = new Date(now.getTime() + RESERVATION_EXPIRY_MINUTES * 60000);
    const reservation = await tx.reservation.create({ data: { eventId, userId, quantity, status: "ACTIVE", expiresAt } });
    await tx.ticket.createMany({ data: Array.from({ length: quantity }, () => ({ eventId, reservationId: reservation.id, status: "RESERVED" })) });
    await auditLog("RESERVATION_CREATED", "Reservation", reservation.id, userId, JSON.stringify({ quantity, expiresAt: expiresAt.toISOString() }), tx);
    return tx.reservation.findUniqueOrThrow({ where: { id: reservation.id }, include: { event: { include: { location: true, timeSlot: true } } } });
  });
}

export async function purchaseReservation(reservationId: string, userId: string) {
  const candidate = await prisma.reservation.findFirst({ where: { id: reservationId, userId }, select: { eventId: true } });
  if (!candidate) throw new BookingError(404, "Reservation not found or expired");
  const result = await bookingTransaction(async tx => {
    await lockEvent(tx, candidate.eventId);
    const row = await lockReservation(tx, reservationId);
    if (!row || row.userId !== userId) throw new BookingError(404, "Reservation not found or expired");
    if (row.status === "EXPIRED") return { expired: true as const };
    if (row.status !== "ACTIVE") throw new BookingError(404, "Reservation not found or expired");
    const now = await databaseNow(tx);
    if (row.expiresAt <= now) {
      await expireLocked(tx, row);
      // Return an outcome so expiry and its audit commit. Reject HTTP purchase AFTER commit.
      return { expired: true as const };
    }
    const user = await tx.user.findUnique({ where: { id: userId }, select: { deletedAt: true, emailVerifiedAt: true } });
    if (!user || user.deletedAt) throw new BookingError(401, "User not found or deactivated");
    if (!user.emailVerifiedAt) throw new BookingError(403, "Email verification required");
    const changed = await tx.ticket.updateMany({ where: { reservationId, eventId: row.eventId, status: "RESERVED", userId: null }, data: { status: "SOLD", userId, purchasedAt: now } });
    if (changed.count !== row.quantity) throw new BookingError(409, "Reservation tickets are inconsistent");
    await tx.reservation.update({ where: { id: reservationId }, data: { status: "CONVERTED" } });
    await tx.verificationCode.deleteMany({ where: { reservationId } });
    const tickets = await tx.ticket.findMany({ where: { reservationId }, include: { event: { include: { location: true, timeSlot: true } } } });
    await auditLog("PURCHASE", "Reservation", reservationId, userId, JSON.stringify({ ticketIds: tickets.map(t => t.id) }), tx);
    return { expired: false as const, tickets };
  });
  if (result.expired) throw new BookingError(400, "Reservation has expired");
  return result.tickets;
}

export async function expireReservation(id: string, eventId: string): Promise<boolean> {
  return bookingTransaction(async tx => {
    // Cancellation can remove the event between discovery and this lock.
    try { await lockEvent(tx, eventId); } catch (error) {
      if (error instanceof BookingError && error.status === 404) return false;
      throw error;
    }
    const row = await lockReservation(tx, id);
    if (!row || row.eventId !== eventId || row.status !== "ACTIVE") return false;
    if (row.expiresAt > await databaseNow(tx)) return false;
    await expireLocked(tx, row);
    return true;
  });
}

export async function changeEventCapacity(eventId: string, capacity: number, adminId: string) {
  if (!Number.isInteger(capacity) || capacity <= 0) throw new BookingError(400, "Capacity must be a positive integer");
  return bookingTransaction(async tx => {
    const event = await lockEvent(tx, eventId);
    const [location] = await tx.$queryRaw<Array<{ maxCapacity: number }>>`SELECT "maxCapacity" FROM "Location" WHERE id = ${event.locationId} FOR SHARE`;
    const taken = await tx.ticket.count({ where: { eventId, status: { in: occupied } } });
    if (capacity < taken) throw new BookingError(400, `Cannot set capacity below current taken count (${taken})`);
    if (!location || capacity > location.maxCapacity) throw new BookingError(400, "Override capacity cannot exceed location maximum");
    await tx.event.update({ where: { id: eventId }, data: { capacity } });
    await auditLog("EVENT_CAPACITY_OVERRIDE", "Event", eventId, adminId, JSON.stringify({ newCapacity: capacity }), tx);
    return capacity;
  });
}

export async function refundTicket(ticketId: string, adminId: string) {
  const candidate = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { eventId: true, reservationId: true } });
  if (!candidate) throw new BookingError(404, "Ticket not found");
  return bookingTransaction(async tx => {
    await lockEvent(tx, candidate.eventId);
    if (candidate.reservationId) await lockReservation(tx, candidate.reservationId);
    const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new BookingError(404, "Ticket not found");
    if (ticket.status !== "SOLD") throw new BookingError(400, "Only SOLD tickets can be refunded");
    await tx.ticket.update({ where: { id: ticketId }, data: { status: "REFUNDED" } });
    await auditLog("TICKET_REFUNDED", "Ticket", ticketId, adminId, undefined, tx);
  });
}

export async function cancelEvent(eventId: string, adminId: string) {
  return bookingTransaction(async tx => {
    const event = await lockEvent(tx, eventId);
    if (event.status === "CANCELLED") throw new BookingError(400, "Event already cancelled");
    await tx.$queryRaw`SELECT id FROM "Reservation" WHERE "eventId" = ${eventId} ORDER BY id FOR UPDATE`;
    await tx.verificationCode.deleteMany({ where: { reservation: { eventId } } });
    await tx.ticket.deleteMany({ where: { eventId } });
    await tx.reservation.deleteMany({ where: { eventId } });
    await tx.eventComment.deleteMany({ where: { eventId } });
    await tx.event.delete({ where: { id: eventId } });
    await auditLog("EVENT_CANCELLED", "Event", eventId, adminId, undefined, tx);
  });
}
