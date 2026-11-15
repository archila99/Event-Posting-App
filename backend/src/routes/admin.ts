import { asyncHandler } from "../lib/asyncHandler.js";
import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { withEventImageDisplayUrl } from "../lib/storage.js";
import { Role } from "../types.js";
import { auditLog } from "../lib/audit.js";
import { cancelEvent, changeEventCapacity, refundTicket } from "../services/bookingService.js";
export const adminRouter = Router();
const admin = authMiddleware;
const onlyAdmin = requireRole(Role.ADMIN);

adminRouter.get("/events", admin, onlyAdmin, asyncHandler(async (_req, res) => {
  const result = await prisma.$transaction(async tx => {
    const list = await tx.event.findMany({
      include: {
        artist: { select: { id: true, name: true, email: true } },
        location: { select: { id: true, name: true, maxCapacity: true } },
        timeSlot: { select: { id: true, name: true, startTime: true, endTime: true } },
      },
      orderBy: [{ date: "asc" }, { createdAt: "desc" }],
    });
    const withTaken = await Promise.all(
      list.map(async (e) => {
        const taken = await tx.ticket.count({ where: { eventId: e.id, status: { in: ["RESERVED", "SOLD"] } } });
        return { ...e, taken, available: e.capacity - taken };
      })
    );
    const withDisplayUrl = withTaken.map((e) => withEventImageDisplayUrl(e));
    return withDisplayUrl;
  }, { isolationLevel: "RepeatableRead" });
  return res.json(result);
}));

adminRouter.post(
  "/events/:id/cancel", admin, onlyAdmin,
  asyncHandler(async (req: express.Request & { user?: { userId: string } }, res) => {
    await cancelEvent(req.params.id, req.user!.userId);
    return res.json({ message: "Event deleted; reservations and tickets removed; slot is free for a new event." });
  })
);

const overrideCapacitySchema = z.object({ capacity: z.number().int().positive() });

adminRouter.patch(
  "/events/:id/capacity",
  admin,
  onlyAdmin,
  asyncHandler(async (req: express.Request & { user?: { userId: string } }, res) => {
    const parsed = overrideCapacitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const capacity = await changeEventCapacity(req.params.id, parsed.data.capacity, req.user!.userId);
    return res.json({ message: "Capacity updated", capacity });
  })
);

adminRouter.get("/reservations", admin, onlyAdmin, asyncHandler(async (req, res) => {
  const eventId = req.query.eventId as string | undefined;
  const list = await prisma.reservation.findMany({
    where: eventId ? { eventId } : {},
    include: {
      event: {
        select: { id: true, date: true, title: true, location: true, timeSlot: true },
      },
      user: { select: { id: true, email: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json(list);
}));

adminRouter.get("/purchases", admin, onlyAdmin, asyncHandler(async (req, res) => {
  const eventId = req.query.eventId as string | undefined;
  const sold = await prisma.ticket.findMany({
    where: { status: "SOLD", ...(eventId ? { eventId } : {}) },
    include: {
      event: {
        select: { id: true, date: true, title: true, location: true, timeSlot: true },
      },
      user: { select: { id: true, email: true, name: true } },
    },
    orderBy: { purchasedAt: "desc" },
  });
  return res.json(sold);
}));

adminRouter.get("/audit", admin, onlyAdmin, asyncHandler(async (req, res) => {
  const entityType = req.query.entityType as string | undefined;
  const entityId = req.query.entityId as string | undefined;
  const logs = await prisma.auditLog.findMany({
    where: {
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
    },
    include: { user: { select: { id: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return res.json(logs);
}));

adminRouter.post(
  "/tickets/:id/refund",
  admin,
  onlyAdmin,
  asyncHandler(async (req: express.Request & { user?: { userId: string } }, res) => {
    await refundTicket(req.params.id, req.user!.userId);
    return res.json({ message: "Ticket refunded" });
  })
);

adminRouter.patch(
  "/users/:id/deactivate",
  admin,
  onlyAdmin,
  asyncHandler(async (req: express.Request & { user?: { userId: string } }, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: "User not found" });
    if (target.role === "ADMIN") return res.status(400).json({ error: "Cannot deactivate admin" });
    await prisma.user.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date() },
    });
    await auditLog("USER_DEACTIVATED", "User", req.params.id, req.user?.userId);
    return res.json({ message: "User deactivated; historical data retained for audit" });
  })
);
