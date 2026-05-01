import express, { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, type AuthPayload } from "../middleware/auth.js";
import { sendVerificationCode, sendPasswordResetCode } from "../lib/email.js";
import { signAccessToken } from "../lib/accessToken.js";
import {
  clearRefreshTokenCookie,
  generateRefreshTokenRaw,
  hashRefreshToken,
  parseDurationToMs,
  REFRESH_COOKIE_NAME,
  setRefreshTokenCookie,
} from "../lib/refreshToken.js";

const CODE_EXPIRY_MINUTES = 10;

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

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const registerSchema = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  password: z.string().min(6),
  name: z.string().min(1),
  role: z.enum(["USER", "ARTIST"]),
});

const verifySchema = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  code: z.string().transform((s) => s.trim().replace(/\D/g, "").slice(0, 6)).refine((s) => s.length === 6, "Code must be 6 digits"),
});

const resendSchema = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
});

const loginSchema = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  password: z.string(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
});

const resetPasswordSchema = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  code: z.string().transform((s) => s.trim().replace(/\D/g, "").slice(0, 6)).refine((s) => s.length === 6, "Code must be 6 digits"),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
});

export const authRouter = Router();

authRouter.post("/refresh", async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!raw || typeof raw !== "string") {
    clearRefreshTokenCookie(res);
    return res.status(401).json({ error: "Unauthorized" });
  }
  const tokenHash = hashRefreshToken(raw);
  const existing = await prisma.refreshToken.findFirst({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: { select: { id: true, email: true, role: true, deletedAt: true } } },
  });
  if (!existing?.user || existing.user.deletedAt) {
    clearRefreshTokenCookie(res);
    return res.status(401).json({ error: "Unauthorized" });
  }

  const newRaw = generateRefreshTokenRaw();
  const newHash = hashRefreshToken(newRaw);
  const expiresMs = parseDurationToMs(process.env.REFRESH_TOKEN_EXPIRES_IN, 7 * 86_400_000);
  const newExpiresAt = new Date(Date.now() + expiresMs);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });
      await tx.refreshToken.create({
        data: { userId: existing.userId, tokenHash: newHash, expiresAt: newExpiresAt },
      });
    });
  } catch (e) {
    console.error("[auth/refresh]", e instanceof Error ? e.message : e);
    clearRefreshTokenCookie(res);
    return res.status(401).json({ error: "Unauthorized" });
  }

  setRefreshTokenCookie(res, newRaw);
  const token = signAccessToken({
    userId: existing.user.id,
    email: existing.user.email,
    role: existing.user.role,
  });
  return res.json({ token });
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

// --- REGISTER: temp data only (PendingRegistration). No User row until email is verified. ---
authRouter.post("/register", async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { email, password, name, role } = parsed.data;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);
    const passwordHash = await bcrypt.hash(password, 10);

    // Store temporarily in PendingRegistration only. Do NOT create User.
    await prisma.pendingRegistration.deleteMany({ where: { email } });
    await prisma.pendingRegistration.create({
      data: { email, passwordHash, name, role, code, expiresAt },
    });

    let emailSent = false;
    let emailError: string | undefined;
    console.log("[register] Sending verification email to", email);
    try {
      emailSent = await sendVerificationCode(email, code);
      console.log("[register] Verification email result: sent =", emailSent);
    } catch (err) {
      emailError = err instanceof Error ? err.message : String(err);
      console.error("[register] Email send failed:", emailError);
      emailSent = false;
    }

    const message: string = emailSent
      ? "Verification code sent to your email. Enter it to complete registration."
      : "Email could not be sent. Use the code below to verify.";
    const payload: Record<string, unknown> = {
      message,
      expiresInMinutes: CODE_EXPIRY_MINUTES,
    };
    if (!emailSent) {
      payload.devCode = code;
      if (emailError) payload.emailError = emailError;
    }
    // Include devCode so you can verify if the email doesn't arrive (set in .env for local dev)
    if (process.env.INCLUDE_DEV_CODE === "true") {
      payload.devCode = code;
    }
    return res.status(201).json(payload);
  } catch (e) {
    console.error("[register] error:", e instanceof Error ? e.message : e);
    next(e);
  }
});

// --- VERIFY: save to User table only when 6-digit code matches and is not expired ---
authRouter.post("/verify-email", async (req, res, next) => {
  try {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    const { email, code } = parsed.data;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: "Email already registered. Please log in." });
    }

    const pending = await prisma.pendingRegistration.findUnique({ where: { email } });
    if (!pending) {
      return res.status(400).json({ error: "No pending registration for this email. Please register first." });
    }
    const notExpired = new Date() <= pending.expiresAt;
    const codeMatch = pending.code === code;
    if (!notExpired) {
      await prisma.pendingRegistration.deleteMany({ where: { email } });
      return res.status(400).json({ error: "Verification code has expired. Please request a new code." });
    }
    if (!codeMatch) {
      return res.status(400).json({ error: "Code does not match. Please check and try again." });
    }

    // Only after code matches: create User and remove temp data.
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: pending.email,
          password: pending.passwordHash,
          name: pending.name,
          role: pending.role,
          emailVerifiedAt: new Date(),
        },
        select: { id: true, email: true, name: true, role: true, createdAt: true, emailVerifiedAt: true },
      });
      await tx.pendingRegistration.delete({ where: { email: pending.email } });
      return created;
    });

    await issueRefreshSession(res, user.id);
    const token = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });
    return res.status(201).json({
      success: true,
      user: { ...user, emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null },
      token,
    });
  } catch (e) {
    console.error("[verify-email] error:", e instanceof Error ? e.message : e);
    next(e);
  }
});

// --- RESEND: email only, delete old code, insert new, send email ---
authRouter.post("/resend-verification-code", async (req, res, next) => {
  try {
    const parsed = resendSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Valid email required" });
    }
    const { email } = parsed.data;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: "Email already registered. Please log in." });
    }

    const pending = await prisma.pendingRegistration.findUnique({ where: { email } });
    if (!pending) {
      return res.status(400).json({ error: "No pending registration for this email. Please register first." });
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);
    await prisma.pendingRegistration.update({
      where: { email },
      data: { code, expiresAt },
    });

    console.log("[resend] Sending verification email to", email);
    try {
      const sent = await sendVerificationCode(email, code);
      console.log("[resend] Verification email result: sent =", sent);
      if (!sent) {
        return res.json({
          message: "Email not configured. Use the code below.",
          devCode: code,
          expiresInMinutes: CODE_EXPIRY_MINUTES,
        });
      }
    } catch (err) {
      console.error("[resend] Email send failed:", err instanceof Error ? err.message : err);
      return res.status(503).json({
        error: "Failed to send verification email.",
        devCode: code,
        expiresInMinutes: CODE_EXPIRY_MINUTES,
      });
    }
    return res.json({
      message: "Verification code sent to your email",
      expiresInMinutes: CODE_EXPIRY_MINUTES,
    });
  } catch (e) {
    console.error("[resend-verification-code] error:", e instanceof Error ? e.message : e);
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

// --- FORGOT PASSWORD: send 6-digit code to email (only if user exists; don't reveal otherwise) ---
authRouter.post("/forgot-password", async (req, res, next) => {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Valid email required" });
    }
    const { email } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) {
      // Do not reveal whether the email exists; also do not send mail.
      console.log(
        "[forgot-password] No active User for this email — not sending mail (same response as success). If you never finished signup, use Register → verify instead."
      );
      return res.json({ message: "If an account exists with this email, we sent a password reset code. Check your inbox and spam." });
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);
    await prisma.pendingPasswordReset.upsert({
      where: { email },
      create: { email, code, expiresAt },
      update: { code, expiresAt },
    });

    let emailSent = false;
    try {
      emailSent = await sendPasswordResetCode(email, code);
    } catch (err) {
      console.error("[forgot-password] Email send failed:", err instanceof Error ? err.message : err);
      return res.status(503).json({ error: "Failed to send reset code. Try again later." });
    }

    return res.json({
      message: emailSent
        ? "If an account exists with this email, we sent a password reset code. Check your inbox and spam."
        : "Email could not be sent. Please try again later or contact support.",
      expiresInMinutes: CODE_EXPIRY_MINUTES,
    });
  } catch (e) {
    console.error("[forgot-password] error:", e instanceof Error ? e.message : e);
    next(e);
  }
});

// --- RESET PASSWORD: verify code then overwrite user password ---
authRouter.post("/reset-password", async (req, res, next) => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? "Invalid input";
      return res.status(400).json({ error: msg });
    }
    const { email, code, newPassword } = parsed.data;

    const pending = await prisma.pendingPasswordReset.findUnique({ where: { email } });
    if (!pending) {
      return res.status(400).json({ error: "No password reset requested for this email. Request a new code." });
    }
    if (new Date() > pending.expiresAt) {
      await prisma.pendingPasswordReset.deleteMany({ where: { email } });
      return res.status(400).json({ error: "Reset code has expired. Request a new code." });
    }
    if (pending.code !== code) {
      return res.status(400).json({ error: "Code does not match. Please check and try again." });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction([
      prisma.user.update({ where: { email }, data: { password: passwordHash } }),
      prisma.pendingPasswordReset.delete({ where: { email } }),
    ]);

    return res.json({ message: "Password updated. You can now log in with your new password." });
  } catch (e) {
    console.error("[reset-password] error:", e instanceof Error ? e.message : e);
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
