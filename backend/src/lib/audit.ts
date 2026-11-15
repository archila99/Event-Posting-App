import { prisma } from "./prisma.js";
import type { Prisma } from "@prisma/client";

export async function auditLog(
  action: string,
  entityType: string,
  entityId: string,
  userId?: string | null,
  details?: string,
  db: Pick<Prisma.TransactionClient, "auditLog"> = prisma
) {
  await db.auditLog.create({
    data: { action, entityType, entityId, userId, details },
  });
}
