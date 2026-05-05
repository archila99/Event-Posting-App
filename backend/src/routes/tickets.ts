import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireEmailVerified } from "../middleware/auth.js";
import { auditLog } from "../lib/audit.js";
import bcrypt from "bcryptjs";

const VERIFICATION_CODE_EXPIRY_MINUTES = 10;

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export const ticketsRouter = Router();

ticketsRouter.use(authMiddleware);
ticketsRouter.use((req, res, next) => {
  void requireEmailVerified(req, res, next).catch(next);
});

ticketsRouter.get("/my", async (req: express.Request & { user?: { userId: string } }, res) => {
  const list = await prisma.ticket.findMany({
    where: { userId: req.user!.userId, status: "SOLD" },
    include: {
      event: {
        select: {
          id: true,
          date: true,
          title: true,
          status: true,
          location: true,
          timeSlot: true,
        },
      },
    },
    orderBy: { purchasedAt: "desc" },
  });
  return res.json(list);
});

ticketsRouter.post("/send-verification-code/:reservationId", async (req: express.Request & { user?: { userId: string } }, res) => {
  const { reservationId } = req.params;
  const userId = req.user!.userId;

  const [reservation, user] = await Promise.all([
    prisma.reservation.findFirst({
      where: { id: reservationId, userId, status: "ACTIVE" },
      include: { event: true, user: { select: { email: true } } },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } }),
  ]);
  if (!reservation) {
    return res.status(404).json({ error: "Reservation not found or expired" });
  }
  if (new Date() > reservation.expiresAt) {
    return res.status(400).json({ error: "Reservation has expired" });
  }

  if (user?.emailVerifiedAt) {
    return res.json({ skipVerification: true, message: "Your email is already verified. You can confirm purchase without a code." });
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000);
  const codeHash = await bcrypt.hash(code, 10);

  await prisma.verificationCode.upsert({
    where: { reservationId },
    create: { userId, reservationId, codeHash, expiresAt },
    update: { codeHash, expiresAt },
  });

  // UI-delivery demo (no email): return preview to the client.
  return res.json({ message: "Verification code generated", codePreview: code, expiresInMinutes: VERIFICATION_CODE_EXPIRY_MINUTES });
});

const purchaseSchema = z.object({ code: z.string().length(6).optional() });

ticketsRouter.post("/purchase/:reservationId", async (req: express.Request & { user?: { userId: string } }, res) => {
  const { reservationId } = req.params;
  const userId = req.user!.userId;

  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request", details: parsed.error.flatten() });
  }
  const { code } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } });
  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, userId, status: "ACTIVE" },
    include: { event: true, tickets: true },
  });

  if (!reservation) {
    return res.status(404).json({ error: "Reservation not found or expired" });
  }
  if (new Date() > reservation.expiresAt) {
    await prisma.$transaction(async (tx) => {
      await tx.reservation.update({ where: { id: reservationId }, data: { status: "EXPIRED" } });
      await tx.ticket.updateMany({ where: { reservationId }, data: { status: "EXPIRED" } });
    });
    return res.status(400).json({ error: "Reservation has expired" });
  }

  const isEmailVerified = !!user?.emailVerifiedAt;

  if (!isEmailVerified) {
    if (!code || code.length !== 6) {
      return res.status(400).json({ error: "Verification code required. Request a code from the reservation page." });
    }
    const verification = await prisma.verificationCode.findUnique({
      where: { reservationId },
      include: { reservation: true },
    });
    if (!verification || verification.userId !== userId) {
      return res.status(400).json({ error: "Verification code not found or invalid. Request a new code." });
    }
    if (new Date() > verification.expiresAt) {
      await prisma.verificationCode.delete({ where: { reservationId } }).catch(() => {});
      return res.status(400).json({ error: "Verification code has expired. Request a new code." });
    }
    const ok = await bcrypt.compare(code, verification.codeHash);
    if (!ok) {
      return res.status(400).json({ error: "Invalid verification code." });
    }
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.verificationCode.delete({ where: { reservationId } }).catch(() => {});
    await tx.reservation.update({
      where: { id: reservationId },
      data: { status: "CONVERTED" },
    });
    await tx.ticket.updateMany({
      where: { reservationId },
      data: { status: "SOLD", userId, purchasedAt: now },
    });
  });

  const tickets = await prisma.ticket.findMany({
    where: { reservationId },
    include: { event: { include: { location: true, timeSlot: true } } },
  });
  await auditLog("PURCHASE", "Reservation", reservationId, userId, JSON.stringify({ ticketIds: tickets.map((t) => t.id) }));
  return res.json({ message: "Purchase confirmed", tickets });
});
