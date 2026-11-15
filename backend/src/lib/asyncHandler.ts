import type { Request, Response, NextFunction, RequestHandler } from "express";

export function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler {
  return (req, res, next) => { Promise.resolve().then(() => handler(req, res, next)).catch(next); };
}
