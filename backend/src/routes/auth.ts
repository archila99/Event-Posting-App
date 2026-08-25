import express, { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, type AuthPayload } from "../middleware/auth.js";
import { signAccessToken } from "../lib/accessToken.js";
import { startSignupSession, verifySignupSession } from "../services/authService.js";
import {
  clearRefreshTokenCookie,
  generateRefreshTokenRaw,
  hashRefreshToken,
  parseDurationToMs,
  REFRESH_COOKIE_NAME,
  setRefreshTokenCookie,
} from "../lib/refreshToken.js";

async function issueRefreshSession(res: express.Response, userId: string) {
  const raw = generateRefreshTokenRaw();
  const tokenHash = hashRefreshToken(raw);
  const expiresMs = parseDurationToMs(process.env.REFRESH_TOKEN_EXPIRES_IN, 7 * 86_400_000);
  const expiresAt = new Date(Date.now() + expiresMs);
  await prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt },
  });
  setRefreshTokenCookie(res, raw);
}

const registerSchema = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  password: z.string().min(6),
  name: z.string().min(1),
  role: z.enum(["USER", "ARTIST"]),
});

const otpVerifySchema = z.object({
  sessionId: z.string().min(1),
  code: z
    .string()
    .transform((s) => s.trim().replace(/\D/g, "").slice(0, 6))
    .refine((s) => s.length === 6, "Code must be 6 digits"),
});

const loginSchema = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  password: z.string(),
});

export const authRouter = Router();

authRouter.post("/refresh", async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!raw || typeof raw !== "string") {
    clearRefreshTokenCookie(res);
    return res.status(401).json({ error: "Unauthorized" });
  }
  const tokenHash = hashRefreshToken(raw);

  const newRaw = generateRefreshTokenRaw();
  const newHash = hashRefreshToken(newRaw);
  const expiresMs = parseDurationToMs(process.env.REFRESH_TOKEN_EXPIRES_IN, 7 * 86_400_000);
  const newExpiresAt = new Date(Date.now() + expiresMs);

  try {
    const user = await prisma.$transaction(async (tx) => {
      // Serialize rotation on this refresh-token row (single-use under concurrency).
      const locked = await tx.$queryRaw<
        Array<{ id: string; userId: string; revokedAt: Date | null; expiresAt: Date }>
      >`
        SELECT id, "userId", "revokedAt", "expiresAt"
        FROM "RefreshToken"
        WHERE "tokenHash" = ${tokenHash}
        FOR UPDATE
      `;
      const row = locked[0];
      if (!row || row.revokedAt != null || !(new Date(row.expiresAt) > new Date())) {
        throw new Error("REFRESH_UNAUTHORIZED");
      }

      const tokenUser = await tx.user.findUnique({
        where: { id: row.userId },
        select: { id: true, email: true, role: true, deletedAt: true },
      });
      if (!tokenUser || tokenUser.deletedAt) {
        throw new Error("REFRESH_UNAUTHORIZED");
      }

      await tx.refreshToken.update({
        where: { id: row.id },
        data: { revokedAt: new Date() },
      });
      await tx.refreshToken.create({
        data: { userId: row.userId, tokenHash: newHash, expiresAt: newExpiresAt },
      });

      return tokenUser;
    });

    setRefreshTokenCookie(res, newRaw);
    const token = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });
    return res.json({ token });
  } catch (e) {
    if (!(e instanceof Error && e.message === "REFRESH_UNAUTHORIZED")) {
      console.error("[auth/refresh]", e instanceof Error ? e.message : e);
    }
    clearRefreshTokenCookie(res);
    return res.status(401).json({ error: "Unauthorized" });
  }
});

authRouter.post("/logout", async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE_NAME];
  clearRefreshTokenCookie(res);
  if (raw && typeof raw === "string") {
    const tokenHash = hashRefreshToken(raw);
    await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  return res.json({ ok: true });
});

// --- SIGNUP: create pending verification session only (no User row) ---
authRouter.post("/register", async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { email, password, name, role } = parsed.data;

    const result = await startSignupSession({ email, password, name, role });
    if (!result.ok && result.reason === "EMAIL_TAKEN") return res.status(409).json({ error: "Email already registered" });
    if (!result.ok) return res.status(400).json({ error: "Could not start signup session" });
    return res.status(201).json({ message: "OTP generated", sessionId: result.sessionId, otpPreview: result.otpPreview, expiresInMinutes: 5 });
  } catch (e) {
    console.error("[register] error:", e instanceof Error ? e.message : e);
    next(e);
  }
});

// --- VERIFY OTP: create final User + issue JWT ---
authRouter.post("/verify-otp", async (req, res, next) => {
  try {
    const parsed = otpVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    const { sessionId, code } = parsed.data;

    const result = await verifySignupSession({ sessionId, code });
    if (!result.ok) {
      const msg =
        result.reason === "EXPIRED"
          ? "OTP expired. Please sign up again to generate a new one."
          : result.reason === "MISMATCH"
            ? "Code does not match. Please check and try again."
            : "OTP could not be verified.";
      return res.status(400).json({ error: msg });
    }

    await issueRefreshSession(res, result.user.id);
    const token = signAccessToken({
      userId: result.user.id,
      email: result.user.email,
      role: result.user.role,
    });
    return res.status(201).json({
      success: true,
      user: {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
        emailVerifiedAt: result.user.emailVerifiedAt?.toISOString() ?? null,
      },
      token,
    });
  } catch (e) {
    console.error("[verify-otp] error:", e instanceof Error ? e.message : e);
    next(e);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) return res.status(401).json({ error: "Invalid credentials" });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });
    await issueRefreshSession(res, user.id);
    const token = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });
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
  } catch (e) {
    console.error("[login] error:", e instanceof Error ? e.message : e);
    next(e);
  }
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
