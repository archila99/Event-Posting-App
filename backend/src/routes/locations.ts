import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "../types.js";
import { auditLog } from "../lib/audit.js";

const createSchema = z.object({ name: z.string().min(1), maxCapacity: z.number().int().positive() });
const updateSchema = createSchema.partial().extend({ isActive: z.boolean().optional() });

export const locationsRouter = Router();

locationsRouter.get("/", async (_req, res) => {
  const list = await prisma.location.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  return res.json(list);
});

locationsRouter.get("/all", authMiddleware, requireRole(Role.ADMIN), async (_req, res) => {
  const list = await prisma.location.findMany({ orderBy: { name: "asc" } });
  return res.json(list);
});

locationsRouter.get("/:id", async (req, res) => {
  const loc = await prisma.location.findUnique({ where: { id: req.params.id } });
  if (!loc) return res.status(404).json({ error: "Location not found" });
  return res.json(loc);
});

locationsRouter.post(
  "/",
  authMiddleware,
  requireRole(Role.ADMIN),
  async (req: express.Request & { user?: { userId: string } }, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const loc = await prisma.location.create({ data: parsed.data });
    await auditLog("LOCATION_CREATED", "Location", loc.id, req.user?.userId);
    return res.status(201).json(loc);
  }
);

locationsRouter.patch(
  "/:id",
  authMiddleware,
  requireRole(Role.ADMIN),
  async (req: express.Request & { user?: { userId: string } }, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const loc = await prisma.location.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    await auditLog("LOCATION_UPDATED", "Location", loc.id, req.user?.userId);
    return res.json(loc);
  }
);

locationsRouter.delete(
  "/:id",
  authMiddleware,
  requireRole(Role.ADMIN),
  async (req: express.Request & { user?: { userId: string } }, res) => {
    await prisma.location.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    await auditLog("LOCATION_DEACTIVATED", "Location", req.params.id, req.user?.userId);
    return res.status(204).send();
  }
);
