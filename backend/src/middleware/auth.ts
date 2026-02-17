import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "../types.js";

const JWT_SECRET = process.env.JWT_SECRET || "secret";

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
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
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
    req.user = jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    // ignore
  }
  next();
}
