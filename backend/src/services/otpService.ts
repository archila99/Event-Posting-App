import crypto from "crypto";
import bcrypt from "bcryptjs";

const OTP_TTL_MS = 5 * 60 * 1000;

export function otpExpiresAt(now = Date.now()): Date {
  return new Date(now + OTP_TTL_MS);
}

export function generateOtp6(): string {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}

export async function hashOtp(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

export async function verifyOtpHash(code: string, otpHash: string): Promise<boolean> {
  return bcrypt.compare(code, otpHash);
}

