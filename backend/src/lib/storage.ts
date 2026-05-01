/**
 * Event images: local disk storage.
 *
 * Note: This project previously supported Google Cloud Storage. That deployment-specific
 * implementation was removed as part of a GCP cleanup. The app logic and routes remain
 * unchanged; `Event.imageUrl` continues to store either a local `/api/uploads/...` URL
 * or an external URL if provided.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "..", "..", "uploads");

function getExtension(mimetype: string, originalname?: string): string {
  const ext = originalname ? path.extname(originalname).toLowerCase() : "";
  if (ext && /^\.(jpe?g|png|gif|webp)$/.test(ext)) return ext;
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
  };
  return map[mimetype] || ".jpg";
}

/**
 * Save image buffer to local uploads dir. Returns URL path (e.g. /api/uploads/filename).
 */
async function saveToLocal(buffer: Buffer, filename: string): Promise<string> {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const filePath = path.join(uploadsDir, filename);
  fs.writeFileSync(filePath, buffer);
  return "/api/uploads/" + filename;
}

/**
 * Save image to local disk and return URL to store in database (Event.imageUrl).
 */
export async function saveEventImage(
  buffer: Buffer,
  mimetype: string,
  originalname?: string
): Promise<string> {
  const ext = getExtension(mimetype, originalname);
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`;
  void mimetype;
  return saveToLocal(buffer, filename);
}

/**
 * For event API responses: if imageUrl points to a local upload, keep it.
 * If imageUrl is an external URL, keep it as-is.
 */
export function getEventImageDisplayUrl(eventId: string, imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  void eventId;
  return imageUrl;
}

/** Returns a copy of the object with imageUrl set to the display URL (proxy for GCS). Id must be on the object. */
export function withEventImageDisplayUrl<T extends { id: string; imageUrl?: string | null }>(obj: T): T {
  const url = getEventImageDisplayUrl(obj.id, obj.imageUrl ?? null);
  return { ...obj, imageUrl: url ?? obj.imageUrl ?? null };
}

/** Stream an image from GCS to the response. Used when bucket is private (no signed URL). Returns true if streaming started. */
export async function streamGcsImageToResponse(
  imageUrl: string,
  res: import("express").Response
): Promise<boolean> {
  void imageUrl;
  void res;
  return false;
}
