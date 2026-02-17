import { Router } from "express";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "../types.js";
import { prisma } from "../lib/prisma.js";

export const usersRouter = Router();

usersRouter.get("/", authMiddleware, requireRole(Role.ADMIN), async (_req, res) => {
  const list = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return res.json(list);
});
