import express, { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "..", "..", "uploads");
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { withEventImageDisplayUrl, streamGcsImageToResponse } from "../lib/storage.js";
import { Role } from "../types.js";
import { validateEventCreation } from "../services/eventValidation.js";
import { auditLog } from "../lib/audit.js";

import { EVENT_IMAGES } from "../constants/eventImages.js";

const createEventSchema = z.object({
  locationId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeSlotId: z.string(),
  capacity: z.number().int().positive(),
  title: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
});

const createCommentSchema = z.object({
  content: z.string().trim().min(1, "Comment cannot be empty").max(500, "Comment is too long (max 500 characters)"),
  parentId: z.string().optional(),
});

export const eventsRouter = Router();

eventsRouter.get("/", async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const date = req.query.date as string | undefined; // exact date filter (legacy)
    const fromDate = req.query.fromDate as string | undefined; // upcoming filter: date >= fromDate
    const list = await prisma.event.findMany({
      where: {
        status: status === "CANCELLED" ? "CANCELLED" : "APPROVED",
        ...(date ? { date } : {}),
        ...(fromDate ? { date: { gte: fromDate } } : {}),
      },
      include: {
        artist: { select: { id: true, name: true, email: true } },
        location: { select: { id: true, name: true, maxCapacity: true } },
        timeSlot: { select: { id: true, name: true, startTime: true, endTime: true } },
      },
      orderBy: { date: "asc" },
    });
    const withAvailable = list.map((e) => {
      return prisma.ticket.count({ where: { eventId: e.id, status: { in: ["RESERVED", "SOLD"] } } }).then((taken) => ({
        ...e,
        taken,
        available: e.capacity - taken,
      }));
    });
    const result = await Promise.all(withAvailable);
    const withDisplayUrl = result.map((e) => withEventImageDisplayUrl(e));
    return res.json(withDisplayUrl);
  } catch (e) {
    next(e);
  }
});

eventsRouter.get("/:id/image", async (req, res, next) => {
  try {
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      select: { imageUrl: true },
    });
    if (!event?.imageUrl) return res.status(404).end();
    const streamed = await streamGcsImageToResponse(event.imageUrl, res);
    if (streamed) return;
    if (event.imageUrl.startsWith("/api/uploads/")) {
      const filename = event.imageUrl.replace(/^\/api\/uploads\//, "");
      if (!filename || filename.includes("..")) return res.status(404).end();
      return res.sendFile(filename, { root: uploadsDir }, (err) => {
        if (err && !res.headersSent) res.status(404).end();
      });
    }
    return res.status(404).end();
  } catch (e) {
    next(e);
  }
});

eventsRouter.get("/:id", async (req, res, next) => {
  try {
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: {
        artist: { select: { id: true, name: true, email: true } },
        location: { select: { id: true, name: true, maxCapacity: true } },
        timeSlot: { select: { id: true, name: true, startTime: true, endTime: true } },
      },
    });
    if (!event) return res.status(404).json({ error: "Event not found" });
    const taken = await prisma.ticket.count({ where: { eventId: event.id, status: { in: ["RESERVED", "SOLD"] } } });
    const withDisplayUrl = withEventImageDisplayUrl({ ...event, taken, available: event.capacity - taken });
    return res.json(withDisplayUrl);
  } catch (e) {
    next(e);
  }
});

eventsRouter.get("/:id/comments", async (req, res) => {
  const eventId = req.params.id;
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) return res.status(404).json({ error: "Event not found" });

  const list = await prisma.eventComment.findMany({
    where: { eventId },
    include: { user: { select: { id: true, name: true, role: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return res.json(list);
});

eventsRouter.post(
  "/:id/comments",
  authMiddleware,
  async (req: express.Request & { user?: { userId: string } }, res) => {
    const eventId = req.params.id;
    const parsed = createCommentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, status: true } });
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (event.status !== "APPROVED") return res.status(400).json({ error: "Comments are only allowed on approved events" });

    if (parsed.data.parentId) {
      const parent = await prisma.eventComment.findUnique({ where: { id: parsed.data.parentId }, select: { id: true, eventId: true, userId: true } });
      if (!parent || parent.eventId !== eventId) {
        return res.status(400).json({ error: "Invalid parent comment" });
      }
      if (parent.userId === req.user!.userId) {
        return res.status(403).json({ error: "You cannot reply to your own comment" });
      }
    }

    const comment = await prisma.eventComment.create({
      data: { eventId, userId: req.user!.userId, content: parsed.data.content, parentId: parsed.data.parentId ?? null },
      include: { user: { select: { id: true, name: true, role: true } } },
    });
    await auditLog("COMMENT_CREATED", "EventComment", comment.id, req.user!.userId, JSON.stringify({ eventId }));
    return res.status(201).json(comment);
  }
);

eventsRouter.delete(
  "/:id/comments/:commentId",
  authMiddleware,
  async (req: express.Request & { user?: { userId: string; role: Role } }, res) => {
    const eventId = req.params.id;
    const commentId = req.params.commentId;

    const comment = await prisma.eventComment.findUnique({ where: { id: commentId } });
    if (!comment || comment.eventId !== eventId) return res.status(404).json({ error: "Comment not found" });

    const isOwner = comment.userId === req.user!.userId;
    const isAdmin = req.user!.role === Role.ADMIN;
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: "You can only delete your own comments" });
    }

    await prisma.eventComment.delete({ where: { id: commentId } });
    await auditLog("COMMENT_DELETED", "EventComment", commentId, req.user!.userId, JSON.stringify({ eventId }));
    return res.json({ message: "Comment deleted" });
  }
);

eventsRouter.post(
  "/",
  authMiddleware,
  requireRole(Role.ARTIST),
  async (req: express.Request & { user?: { userId: string } }, res, next) => {
    try {
      const parsed = createEventSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const { locationId, date, timeSlotId, capacity, title, description, imageUrl } = parsed.data;
      const img = typeof imageUrl === "string" ? imageUrl.trim() : "";
      if (!img || !(EVENT_IMAGES as readonly string[]).includes(img)) {
        return res.status(400).json({ error: "Invalid image selection" });
      }
      const artistId = req.user!.userId;
      const validation = await validateEventCreation(artistId, locationId, date, timeSlotId, capacity);
      if (!validation.ok) return res.status(400).json({ error: validation.error });
      const event = await prisma.event.create({
        data: {
          artistId,
          locationId,
          timeSlotId,
          date,
          capacity,
          title: title || null,
          description: description || null,
          imageUrl: img,
          status: "APPROVED",
        },
        include: {
          artist: { select: { id: true, name: true, email: true } },
          location: { select: { id: true, name: true } },
          timeSlot: { select: { id: true, name: true, startTime: true, endTime: true } },
        },
      });
      await auditLog("EVENT_CREATED", "Event", event.id, artistId);
    const withDisplayUrl = withEventImageDisplayUrl(event);
    return res.status(201).json(withDisplayUrl);
    } catch (e) {
      next(e);
    }
  }
);

eventsRouter.get(
  "/my/requests",
  authMiddleware,
  requireRole(Role.ARTIST),
  async (req: express.Request & { user?: { userId: string } }, res, next) => {
    try {
      const list = await prisma.event.findMany({
        where: { artistId: req.user!.userId, status: "APPROVED" },
        include: {
          artist: { select: { id: true, name: true, email: true } },
          location: { select: { id: true, name: true } },
          timeSlot: { select: { id: true, name: true, startTime: true, endTime: true } },
        },
        orderBy: [{ date: "asc" }, { createdAt: "desc" }],
      });
      const withDisplayUrl = list.map((e) => withEventImageDisplayUrl(e));
      return res.json(withDisplayUrl);
    } catch (e) {
      next(e);
    }
  }
);
