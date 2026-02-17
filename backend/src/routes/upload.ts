import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { Role } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "..", "..", "uploads");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`;
    cb(null, safe);
  },
});
const upload = multer({
  storage,
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
  (req: Request & { file?: Express.Multer.File }, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "No image file uploaded" });
    const url = "/api/uploads/" + req.file.filename;
    return res.json({ url });
  },
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err) return res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
    return res.status(500).json({ error: "Upload failed" });
  }
);
