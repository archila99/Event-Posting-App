import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { generateOtp6, hashOtp, otpExpiresAt, verifyOtpHash } from "./otpService.js";
import { createVerifiedUser } from "./userService.js";

export async function startSignupSession(args: { email: string; password: string; name: string; role: string }) {
  const existingUser = await prisma.user.findUnique({ where: { email: args.email }, select: { id: true } });
  if (existingUser) return { ok: false as const, reason: "EMAIL_TAKEN" as const };

  const otp = generateOtp6();
  const [passwordHash, otpHash] = await Promise.all([bcrypt.hash(args.password, 10), hashOtp(otp)]);
  const expiresAt = otpExpiresAt();

  // One session per email at a time. Overwrite if it exists and is not used.
  const session = await prisma.pendingSignupSession.upsert({
    where: { email: args.email },
    create: {
      email: args.email,
      passwordHash,
      name: args.name,
      role: args.role,
      otpHash,
      expiresAt,
    },
    update: {
      passwordHash,
      name: args.name,
      role: args.role,
      otpHash,
      expiresAt,
      usedAt: null,
    },
    select: { id: true, expiresAt: true },
  });

  return { ok: true as const, sessionId: session.id, otpPreview: otp, expiresAt: session.expiresAt };
}

export async function verifySignupSession(args: { sessionId: string; code: string }) {
  const code = args.code.trim().replace(/\D/g, "").slice(0, 6);
  if (code.length !== 6) return { ok: false as const, reason: "INVALID_CODE" as const };

  const now = new Date();
  const session = await prisma.pendingSignupSession.findUnique({
    where: { id: args.sessionId },
  });
  if (!session || session.usedAt) return { ok: false as const, reason: "NOT_FOUND" as const };
  if (now > session.expiresAt) return { ok: false as const, reason: "EXPIRED" as const };

  const match = await verifyOtpHash(code, session.otpHash);
  if (!match) return { ok: false as const, reason: "MISMATCH" as const };

  // Atomic: mark session used + create user.
  const created = await prisma.$transaction(async (tx) => {
    const updated = await tx.pendingSignupSession.updateMany({
      where: { id: session.id, usedAt: null },
      data: { usedAt: now },
    });
    if (updated.count !== 1) return null;

    // Safety: re-check email still free at commit time.
    const existing = await tx.user.findUnique({ where: { email: session.email }, select: { id: true } });
    if (existing) return null;

    const user = await createVerifiedUser({
      email: session.email,
      passwordHash: session.passwordHash,
      name: session.name,
      role: session.role,
    });
    return user;
  });

  if (!created) return { ok: false as const, reason: "COMMIT_FAILED" as const };
  return { ok: true as const, user: created };
}

