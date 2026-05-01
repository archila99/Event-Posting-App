import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { getAccessTokenSecret } from "../lib/accessToken.js";
import type { Role } from "../types.js";

export interface AuthPayload {
  userId: string;
  email: string;
  role: Role;
}

export function authMiddleware(req: Request & { user?: AuthPayload }, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, getAccessTokenSecret()) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/** Use after authMiddleware. Returns 403 with VERIFICATION_REQUIRED if user has not verified email. */
export async function requireEmailVerified(req: Request & { user?: AuthPayload }, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { emailVerifiedAt: true },
  });
  if (!user?.emailVerifiedAt) {
    return res.status(403).json({
      error: "Email verification required",
      code: "VERIFICATION_REQUIRED",
    });
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request & { user?: AuthPayload }, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden: insufficient role" });
    }
    next();
  };
}

export function optionalAuth(req: Request & { user?: AuthPayload }, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next();
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, getAccessTokenSecret()) as AuthPayload;
  } catch {
    // ignore
  }
  next();
}
