/**
 * Event images: local disk (development) or Google Cloud Storage (production).
 * Bucket stays private; the API returns signed URLs in event responses so the frontend
 * can display images in event cards without making the bucket public.
 * Returns the URL to store in the database (Event.imageUrl).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "..", "..", "uploads");

function getGcsBucket(): string | undefined {
  const v = process.env.GCS_BUCKET;
  return v && typeof v === "string" && v.trim() ? v.trim() : undefined;
}

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
 * Upload buffer to GCS and return public URL.
 * Bucket should be configured for public read (e.g. allUsers Storage Object Viewer) for the returned URL to work.
 */
async function saveToGCS(buffer: Buffer, filename: string, mimetype: string, bucketName: string): Promise<string> {
  const { Storage } = await import("@google-cloud/storage");
  const storage = new Storage();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(filename);
  await new Promise<void>((resolve, reject) => {
    const stream = file.createWriteStream({
      resumable: false,
      metadata: { contentType: mimetype },
    });
    stream.on("finish", () => resolve());
    stream.on("error", reject);
    stream.end(buffer);
  });
  return `https://storage.googleapis.com/${bucketName}/${filename}`;
}

/**
 * Save image: uses GCS if GCS_BUCKET is set, otherwise local disk.
 * Returns URL to store in database (Event.imageUrl).
 */
export async function saveEventImage(
  buffer: Buffer,
  mimetype: string,
  originalname?: string
): Promise<string> {
  const ext = getExtension(mimetype, originalname);
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`;

  const bucket = getGcsBucket();
  if (bucket) {
    return saveToGCS(buffer, filename, mimetype, bucket);
  }
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[storage] GCS_BUCKET is not set. Event images are saved to ephemeral storage and will not persist. Set GCS_BUCKET in .env.deploy and redeploy."
    );
  }
  return saveToLocal(buffer, filename);
}

const GCS_PUBLIC_PREFIX = "https://storage.googleapis.com/";

/** True if imageUrl is a GCS URL for our configured bucket. */
export function isOurGcsImageUrl(imageUrl: string | null): boolean {
  const bucket = getGcsBucket();
  if (!bucket || !imageUrl || !imageUrl.startsWith(GCS_PUBLIC_PREFIX)) return false;
  const prefix = `${GCS_PUBLIC_PREFIX}${bucket}/`;
  return imageUrl.startsWith(prefix) && imageUrl.length > prefix.length;
}

/**
 * For event API responses: use proxy URL for GCS images (avoids signed-URL permissions on Cloud Run).
 * If imageUrl is our GCS URL and eventId is set, return /api/events/:eventId/image; else return imageUrl.
 */
export function getEventImageDisplayUrl(eventId: string, imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  if (isOurGcsImageUrl(imageUrl)) return `/api/events/${eventId}/image`;
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
  const bucket = getGcsBucket();
  if (!bucket) return false;
  const prefix = `${GCS_PUBLIC_PREFIX}${bucket}/`;
  if (!imageUrl.startsWith(prefix)) return false;
  const objectName = imageUrl.slice(prefix.length);
  if (!objectName) return false;
  try {
    const { Storage } = await import("@google-cloud/storage");
    const storage = new Storage();
    const file = storage.bucket(bucket).file(objectName);
    const [exists] = await file.exists();
    if (!exists) return false;
    const [metadata] = await file.getMetadata();
    const contentType = (metadata?.contentType as string) || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    const readStream = file.createReadStream();
    readStream.on("error", () => {
      if (!res.headersSent) res.status(500).end();
    });
    readStream.pipe(res);
    return true;
  } catch {
    return false;
  }
}
