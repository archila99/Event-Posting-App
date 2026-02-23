import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireEmailVerified } from "../middleware/auth.js";
import { auditLog } from "../lib/audit.js";
import { MAX_TICKETS_PER_USER_PER_EVENT, MIN_TICKETS_PER_RESERVATION, RESERVATION_EXPIRY_MINUTES } from "../constants.js";

const createSchema = z.object({
  eventId: z.string().min(1, "eventId is required"),
  quantity: z.coerce.number().int().min(MIN_TICKETS_PER_RESERVATION).max(MAX_TICKETS_PER_USER_PER_EVENT),
});

export const reservationsRouter = Router();

reservationsRouter.use(authMiddleware);
reservationsRouter.use((req, res, next) => {
  void requireEmailVerified(req, res, next).catch(next);
});

reservationsRouter.get("/my", async (req: express.Request & { user?: { userId: string } }, res) => {
  const list = await prisma.reservation.findMany({
    where: { userId: req.user!.userId },
    include: {
      event: {
        select: {
          id: true,
          date: true,
          capacity: true,
          title: true,
          status: true,
          location: true,
          timeSlot: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  const withAvailable = await Promise.all(
    list.map(async (r) => {
      const taken = await prisma.ticket.count({ where: { eventId: r.eventId, status: { in: ["RESERVED", "SOLD"] } } });
      return { ...r, event: { ...r.event, taken, available: r.event.capacity - taken } };
    })
  );
  return res.json(withAvailable);
});

reservationsRouter.post("/", async (req: express.Request & { user?: { userId: string } }, res) => {
  const body = req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Request body must be JSON with eventId and quantity" });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    const message = first ? `${first.path.join(".")}: ${first.message}` : "Invalid request body";
    const hint = ` (received eventId: ${body.eventId !== undefined ? "yes" : "no"}, quantity: ${body.quantity !== undefined ? body.quantity : "missing"})`;
    return res.status(400).json({ error: message + hint });
  }
  const { eventId, quantity } = parsed.data;
  const userId = req.user!.userId;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || user.role !== "USER") {
    return res.status(403).json({ error: "Only user accounts can reserve tickets. Artists and admins can view events only." });
  }

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { location: true } });
  if (!event) return res.status(404).json({ error: "Event not found" });
  if (event.status !== "APPROVED") {
    return res.status(400).json({ error: `Event is not open for reservations (status: ${event.status}). Only approved events can be reserved.` });
  }

  const existingActive = await prisma.reservation.findFirst({
    where: { eventId, userId, status: "ACTIVE" },
  });
  if (existingActive) return res.status(400).json({ error: "You already have an active reservation for this event" });

  const userTotalForEvent = await prisma.ticket.count({
    where: {
      eventId,
      OR: [{ userId }, { reservation: { userId } }],
      status: { in: ["RESERVED", "SOLD"] },
    },
  });
  if (userTotalForEvent + quantity > MAX_TICKETS_PER_USER_PER_EVENT) {
    return res.status(400).json({
      error: `Maximum ${MAX_TICKETS_PER_USER_PER_EVENT} tickets per user per event. You have ${userTotalForEvent} reserved or sold.`,
    });
  }

  const expiresAt = new Date(Date.now() + RESERVATION_EXPIRY_MINUTES * 60 * 1000);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const taken = await tx.ticket.count({
        where: { eventId, status: { in: ["RESERVED", "SOLD"] } },
      });
      const available = event.capacity - taken;
      if (quantity > available) {
        throw new Error("NOT_ENOUGH_CAPACITY");
      }
      const reservation = await tx.reservation.create({
        data: { eventId, userId, quantity, status: "ACTIVE", expiresAt },
      });
      const tickets = [];
      for (let i = 0; i < quantity; i++) {
        tickets.push(
          tx.ticket.create({
            data: { eventId, reservationId: reservation.id, status: "RESERVED" },
          })
        );
      }
      await Promise.all(tickets);
      return tx.reservation.findUnique({
        where: { id: reservation.id },
        include: {
          event: { include: { location: true, timeSlot: true } },
        },
      });
    });
    if (!result) throw new Error("Create failed");
    await auditLog("RESERVATION_CREATED", "Reservation", result.id, userId, JSON.stringify({ quantity, expiresAt: expiresAt.toISOString() }));
    return res.status(201).json(result);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "NOT_ENOUGH_CAPACITY") {
      return res.status(409).json({ error: "Not enough tickets available" });
    }
    throw e;
  }
});

reservationsRouter.get("/:id", async (req: express.Request & { user?: { userId: string } }, res) => {
  const r = await prisma.reservation.findFirst({
    where: { id: req.params.id, userId: req.user!.userId },
    include: { event: { include: { location: true, timeSlot: true } }, tickets: true },
  });
  if (!r) return res.status(404).json({ error: "Reservation not found" });
  return res.json(r);
});
