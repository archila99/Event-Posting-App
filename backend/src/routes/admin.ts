import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { withEventImageDisplayUrl } from "../lib/storage.js";
import { Role } from "../types.js";
import { auditLog } from "../lib/audit.js";
export const adminRouter = Router();
const admin = authMiddleware;
const onlyAdmin = requireRole(Role.ADMIN);

adminRouter.get("/events", admin, onlyAdmin, async (_req, res) => {
  const list = await prisma.event.findMany({
    include: {
      artist: { select: { id: true, name: true, email: true } },
      location: { select: { id: true, name: true, maxCapacity: true } },
      timeSlot: { select: { id: true, name: true, startTime: true, endTime: true } },
    },
    orderBy: [{ date: "asc" }, { createdAt: "desc" }],
  });
  const withTaken = await Promise.all(
    list.map(async (e) => {
      const taken = await prisma.ticket.count({ where: { eventId: e.id, status: { in: ["RESERVED", "SOLD"] } } });
      return { ...e, taken, available: e.capacity - taken };
    })
  );
  const withDisplayUrl = withTaken.map((e) => withEventImageDisplayUrl(e));
  return res.json(withDisplayUrl);
});

adminRouter.post(
  "/events/:id/cancel",
  admin,
  onlyAdmin,
  async (req: express.Request & { user?: { userId: string } }, res, next) => {
    try {
      const event = await prisma.event.findUnique({
        where: { id: req.params.id },
        include: {
          location: { select: { name: true } },
          timeSlot: { select: { name: true, startTime: true, endTime: true } },
          artist: { select: { email: true } },
        },
      });
      if (!event) return res.status(404).json({ error: "Event not found" });
      if (event.status === "CANCELLED") return res.status(400).json({ error: "Event already cancelled" });

      const [reservationUsers, soldTicketUsers] = await Promise.all([
        prisma.reservation.findMany({
          where: { eventId: event.id, status: "ACTIVE" },
          select: { user: { select: { email: true } } },
        }),
        prisma.ticket.findMany({
          where: { eventId: event.id, status: "SOLD", userId: { not: null } },
          select: { user: { select: { email: true } } },
        }),
      ]);
      const attendeeEmails = new Set<string>();
      reservationUsers.forEach((r) => r.user?.email && attendeeEmails.add(r.user.email));
      soldTicketUsers.forEach((t) => t.user?.email && attendeeEmails.add(t.user.email));

      await prisma.$transaction(async (tx) => {
        const reservations = await tx.reservation.findMany({
          where: { eventId: event.id },
          select: { id: true },
        });
        const reservationIds = reservations.map((r) => r.id);
        if (reservationIds.length > 0) {
          await tx.verificationCode.deleteMany({
            where: { reservationId: { in: reservationIds } },
          });
        }
        await tx.ticket.deleteMany({ where: { eventId: event.id } });
        await tx.reservation.deleteMany({ where: { eventId: event.id } });
        await tx.eventComment.deleteMany({ where: { eventId: event.id } });
        await tx.event.delete({ where: { id: event.id } });
      });
      await auditLog("EVENT_CANCELLED", "Event", event.id, req.user?.userId);

      const eventInfo = {
        title: event.title,
        date: event.date,
        locationName: event.location.name,
        timeSlotName: event.timeSlot.name,
        timeSlotRange: `${event.timeSlot.startTime}–${event.timeSlot.endTime}`,
      };
      console.log("[Cancel] Email notifications removed; skipping notify.", { eventInfo, attendeeCount: attendeeEmails.size });

      return res.json({
        message:
          "Event deleted; reservations and tickets removed; slot is free for a new event.",
      });
    } catch (e) {
      next(e);
    }
  }
);

const overrideCapacitySchema = z.object({ capacity: z.number().int().positive() });

adminRouter.patch(
  "/events/:id/capacity",
  admin,
  onlyAdmin,
  async (req: express.Request & { user?: { userId: string } }, res) => {
    const parsed = overrideCapacitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: { location: true },
    });
    if (!event) return res.status(404).json({ error: "Event not found" });
    const taken = await prisma.ticket.count({ where: { eventId: event.id, status: { in: ["RESERVED", "SOLD"] } } });
    if (parsed.data.capacity < taken) {
      return res.status(400).json({ error: `Cannot set capacity below current taken count (${taken})` });
    }
    if (parsed.data.capacity > event.location.maxCapacity) {
      return res.status(400).json({ error: "Override capacity cannot exceed location maximum" });
    }
    await prisma.event.update({
      where: { id: event.id },
      data: { capacity: parsed.data.capacity },
    });
    await auditLog("EVENT_CAPACITY_OVERRIDE", "Event", event.id, req.user?.userId, JSON.stringify({ newCapacity: parsed.data.capacity }));
    return res.json({ message: "Capacity updated", capacity: parsed.data.capacity });
  }
);

adminRouter.get("/reservations", admin, onlyAdmin, async (req, res) => {
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
});

adminRouter.get("/purchases", admin, onlyAdmin, async (req, res) => {
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
});

adminRouter.get("/audit", admin, onlyAdmin, async (req, res) => {
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
});

adminRouter.post(
  "/tickets/:id/refund",
  admin,
  onlyAdmin,
  async (req: express.Request & { user?: { userId: string } }, res) => {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: {
        event: {
          select: {
            title: true,
            date: true,
            location: { select: { name: true } },
            timeSlot: { select: { name: true, startTime: true, endTime: true } },
          },
        },
        user: { select: { email: true } },
      },
    });
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    if (ticket.status !== "SOLD") return res.status(400).json({ error: "Only SOLD tickets can be refunded" });
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: "REFUNDED" },
    });
    await auditLog("TICKET_REFUNDED", "Ticket", ticket.id, req.user?.userId);

    if (ticket.user?.email) {
      const eventInfo = {
        title: ticket.event.title,
        date: ticket.event.date,
        locationName: ticket.event.location.name,
        timeSlotName: ticket.event.timeSlot.name,
        timeSlotRange: `${ticket.event.timeSlot.startTime}–${ticket.event.timeSlot.endTime}`,
      };
      console.log("[Refund] Email notifications removed; skipping notify.", { to: ticket.user.email, eventInfo });
    }

    return res.json({ message: "Ticket refunded" });
  }
);

adminRouter.patch(
  "/users/:id/deactivate",
  admin,
  onlyAdmin,
  async (req: express.Request & { user?: { userId: string } }, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: "User not found" });
    if (target.role === "ADMIN") return res.status(400).json({ error: "Cannot deactivate admin" });
    await prisma.user.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date() },
    });
    await auditLog("USER_DEACTIVATED", "User", req.params.id, req.user?.userId);
    return res.json({ message: "User deactivated; historical data retained for audit" });
  }
);
