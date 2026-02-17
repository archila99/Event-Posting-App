import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "../types.js";
import { auditLog } from "../lib/audit.js";

const createSchema = z.object({
  name: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
});
const updateSchema = createSchema.partial().extend({ isActive: z.boolean().optional() });

export const timeSlotsRouter = Router();

timeSlotsRouter.get("/", async (_req, res) => {
  const list = await prisma.timeSlot.findMany({
    where: { isActive: true },
    orderBy: { startTime: "asc" },
  });
  return res.json(list);
});

timeSlotsRouter.get("/all", authMiddleware, requireRole(Role.ADMIN), async (_req, res) => {
  const list = await prisma.timeSlot.findMany({ orderBy: { startTime: "asc" } });
  return res.json(list);
});

timeSlotsRouter.get("/:id", async (req, res) => {
  const slot = await prisma.timeSlot.findUnique({ where: { id: req.params.id } });
  if (!slot) return res.status(404).json({ error: "Time slot not found" });
  return res.json(slot);
});

timeSlotsRouter.post(
  "/",
  authMiddleware,
  requireRole(Role.ADMIN),
  async (req: express.Request & { user?: { userId: string } }, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const slot = await prisma.timeSlot.create({ data: parsed.data });
    await auditLog("TIME_SLOT_CREATED", "TimeSlot", slot.id, req.user?.userId);
    return res.status(201).json(slot);
  }
);

timeSlotsRouter.patch(
  "/:id",
  authMiddleware,
  requireRole(Role.ADMIN),
  async (req: express.Request & { user?: { userId: string } }, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const slot = await prisma.timeSlot.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    await auditLog("TIME_SLOT_UPDATED", "TimeSlot", slot.id, req.user?.userId);
    return res.json(slot);
  }
);

timeSlotsRouter.delete(
  "/:id",
  authMiddleware,
  requireRole(Role.ADMIN),
  async (req: express.Request & { user?: { userId: string } }, res) => {
    await prisma.timeSlot.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    await auditLog("TIME_SLOT_DEACTIVATED", "TimeSlot", req.params.id, req.user?.userId);
    return res.status(204).send();
  }
);
