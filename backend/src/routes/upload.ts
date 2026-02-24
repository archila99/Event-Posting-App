import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { saveEventImage } from "../lib/storage.js";
import { Role } from "../types.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype);
    if (allowed) cb(null, true);
    else cb(new Error("Only images (JPEG, PNG, GIF, WebP) are allowed"));
  },
});

export const uploadRouter = express.Router();

uploadRouter.post(
  "/",
  authMiddleware,
  requireRole(Role.ARTIST),
  upload.single("image"),
  async (req: Request & { file?: Express.Multer.File }, res: Response, next: NextFunction) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image file uploaded" });
      const url = await saveEventImage(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      );
      return res.json({ url });
    } catch (e) {
      next(e);
    }
  },
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const msg = err instanceof Error ? err.message : "Upload failed";
    const status = msg.includes("Only images") ? 400 : 500;
    return res.status(status).json({ error: msg });
  }
);
