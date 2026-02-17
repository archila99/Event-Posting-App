import express, { Router } from "express";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Role } from "../types.js";
import { authMiddleware, type AuthPayload } from "../middleware/auth.js";
import { sendVerificationCode } from "../lib/email.js";

const JWT_SECRET = process.env.JWT_SECRET || "secret";
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || "20m") as SignOptions["expiresIn"];
const EMAIL_VERIFY_EXPIRY_MINUTES = 10;

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  role: z.enum(["USER", "ARTIST"]), // Admin cannot be self-registered; create via seed or backend
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const verifyEmailSchema = z.object({ code: z.string().length(6, "Code must be 6 digits") });

export const authRouter = Router();

authRouter.post("/register", async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { email, password, name, role } = parsed.data;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: "Email already registered" });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: passwordHash, name, role },
      select: { id: true, email: true, name: true, role: true, createdAt: true, emailVerifiedAt: true },
    });
    const code = generateCode();
    const expiresAt = new Date(Date.now() + EMAIL_VERIFY_EXPIRY_MINUTES * 60 * 1000);
    await prisma.emailVerificationCode.upsert({
      where: { userId: user.id },
      create: { userId: user.id, code, expiresAt },
      update: { code, expiresAt },
    });
    try {
      await sendVerificationCode(email, code);
    } catch (err) {
      console.error("[register] Email send failed:", err instanceof Error ? err.message : err);
      // still return 201; user can request a new code via verify-email resend or support
    }
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role } as AuthPayload,
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    return res.status(201).json({
      user: { ...user, emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null },
      token,
      verificationRequired: true,
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.deletedAt) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role } as AuthPayload,
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
  return res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    },
    token,
  });
});

authRouter.post("/verify-email", authMiddleware, async (req: express.Request & { user?: AuthPayload }, res) => {
  const userId = req.user!.userId;
  const parsed = verifyEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid code" });
  }
  const { code } = parsed.data;
  const record = await prisma.emailVerificationCode.findUnique({ where: { userId } });
  if (!record) {
    return res.status(400).json({ error: "No verification pending. You may already be verified." });
  }
  if (new Date() > record.expiresAt) {
    await prisma.emailVerificationCode.delete({ where: { userId } }).catch(() => {});
    return res.status(400).json({ error: "Verification code has expired. Please log in and request a new code." });
  }
  if (record.code !== code) {
    return res.status(400).json({ error: "Invalid verification code." });
  }
  await prisma.$transaction([
    prisma.emailVerificationCode.delete({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    }),
  ]);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, createdAt: true, emailVerifiedAt: true },
  });
  return res.json({
    success: true,
    user: user
      ? { ...user, emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null }
      : null,
  });
});

authRouter.get("/me", authMiddleware, async (req: express.Request & { user?: AuthPayload }, res) => {
  const u = req.user!;
  const user = await prisma.user.findUnique({
    where: { id: u.userId },
    select: { id: true, email: true, name: true, role: true, createdAt: true, deletedAt: true, emailVerifiedAt: true },
  });
  if (!user || user.deletedAt) {
    return res.status(401).json({ error: "User not found or deactivated" });
  }
  const { deletedAt: _, ...rest } = user;
  return res.json({
    ...rest,
    emailVerifiedAt: rest.emailVerifiedAt?.toISOString() ?? null,
  });
});
