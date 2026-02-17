import { prisma } from "./prisma.js";

export async function auditLog(
  action: string,
  entityType: string,
  entityId: string,
  userId?: string | null,
  details?: string
) {
  await prisma.auditLog.create({
    data: { action, entityType, entityId, userId, details },
  });
}
