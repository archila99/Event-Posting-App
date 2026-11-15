import { asyncHandler } from "../lib/asyncHandler.js";
import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireEmailVerified } from "../middleware/auth.js";
import { createReservation } from "../services/bookingService.js";
import { MAX_TICKETS_PER_USER_PER_EVENT, MIN_TICKETS_PER_RESERVATION } from "../constants.js";

const createSchema = z.object({
  eventId: z.string().min(1, "eventId is required"),
  quantity: z.coerce.number().int().min(MIN_TICKETS_PER_RESERVATION).max(MAX_TICKETS_PER_USER_PER_EVENT),
});

export const reservationsRouter = Router();

reservationsRouter.use(authMiddleware);
reservationsRouter.use((req, res, next) => {
  void requireEmailVerified(req, res, next).catch(next);
});

reservationsRouter.get("/my", asyncHandler(async (req: express.Request & { user?: { userId: string } }, res) => {
  const result = await prisma.$transaction(async tx => {
    const list = await tx.reservation.findMany({
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
        const taken = await tx.ticket.count({ where: { eventId: r.eventId, status: { in: ["RESERVED", "SOLD"] } } });
        return { ...r, event: { ...r.event, taken, available: r.event.capacity - taken } };
      })
    );
    return withAvailable;
  }, { isolationLevel: "RepeatableRead" });
  return res.json(result);
}));

reservationsRouter.post("/", asyncHandler(async (req: express.Request & { user?: { userId: string } }, res) => {
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

  const result = await createReservation(eventId, userId, quantity);
  return res.status(201).json(result);
}));

reservationsRouter.get("/:id", asyncHandler(async (req: express.Request & { user?: { userId: string } }, res) => {
  const r = await prisma.reservation.findFirst({
    where: { id: req.params.id, userId: req.user!.userId },
    include: { event: { include: { location: true, timeSlot: true } }, tickets: true },
  });
  if (!r) return res.status(404).json({ error: "Reservation not found" });
  return res.json(r);
}));
