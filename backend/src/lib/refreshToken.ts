import { createHmac, randomBytes } from "crypto";
import type { Response } from "express";

export const REFRESH_COOKIE_NAME = "refreshToken";

/** Cookie path so the browser only sends it to API routes. */
export const REFRESH_COOKIE_PATH = "/api";

export function getRefreshTokenSecret(): string {
  return (
    process.env.JWT_REFRESH_SECRET ||
    process.env.REFRESH_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    "refresh-secret-change-me"
  );
}

export function hashRefreshToken(rawToken: string): string {
  const secret = getRefreshTokenSecret();
  return createHmac("sha256", secret).update(rawToken).digest("hex");
}

export function generateRefreshTokenRaw(): string {
  return randomBytes(48).toString("base64url");
}

export function parseDurationToMs(input: string | undefined, fallbackMs: number): number {
  const s = String(input ?? "").trim();
  const m = s.match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  const mult: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (mult[u] ?? fallbackMs);
}

export function refreshCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "none";
  path: string;
  maxAge: number;
} {
  const maxAgeMs = parseDurationToMs(process.env.REFRESH_TOKEN_EXPIRES_IN, 7 * 86_400_000);
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    // Cross-site cookie (Vercel ↔ Render) requires SameSite=None + Secure.
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: REFRESH_COOKIE_PATH,
    // Express expects maxAge in milliseconds.
    maxAge: maxAgeMs,
  };
}

export function setRefreshTokenCookie(res: Response, rawToken: string): void {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, refreshCookieOptions());
}

export function clearRefreshTokenCookie(res: Response): void {
  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: REFRESH_COOKIE_PATH,
  });
}
