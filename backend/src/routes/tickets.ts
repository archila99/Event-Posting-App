import { asyncHandler } from "../lib/asyncHandler.js";
import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireEmailVerified } from "../middleware/auth.js";
import { purchaseReservation } from "../services/bookingService.js";
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

ticketsRouter.get("/my", asyncHandler(async (req: express.Request & { user?: { userId: string } }, res) => {
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
}));

ticketsRouter.post("/send-verification-code/:reservationId", asyncHandler(async (req: express.Request & { user?: { userId: string } }, res) => {
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
}));

const purchaseSchema = z.object({ code: z.string().length(6).optional() });

ticketsRouter.post("/purchase/:reservationId", asyncHandler(async (req: express.Request & { user?: { userId: string } }, res) => {
  const { reservationId } = req.params;
  const userId = req.user!.userId;

  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request", details: parsed.error.flatten() });
  }

  const tickets = await purchaseReservation(reservationId, userId);
  return res.json({ message: "Purchase confirmed", tickets });
}));
