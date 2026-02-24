/**
 * Save uploaded image: local disk (development) or Google Cloud Storage (production).
 * Returns the URL to store in the database (Event.imageUrl).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GCS_BUCKET = process.env.GCS_BUCKET;
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
 * Upload buffer to GCS and return public URL.
 * Bucket should be configured for public read (e.g. allUsers Storage Object Viewer) for the returned URL to work.
 */
async function saveToGCS(buffer: Buffer, filename: string, mimetype: string): Promise<string> {
  const { Storage } = await import("@google-cloud/storage");
  const storage = new Storage();
  const bucket = storage.bucket(GCS_BUCKET!);
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
  return `https://storage.googleapis.com/${GCS_BUCKET}/${filename}`;
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

  if (GCS_BUCKET && GCS_BUCKET.trim()) {
    return saveToGCS(buffer, filename, mimetype);
  }
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[storage] GCS_BUCKET is not set. Event images are saved to ephemeral storage and will not persist. Set GCS_BUCKET in .env.deploy and redeploy."
    );
  }
  return saveToLocal(buffer, filename);
}

const GCS_PUBLIC_PREFIX = "https://storage.googleapis.com/";

/**
 * If imageUrl is a GCS URL for our bucket, return a short-lived signed URL (works when Public Access Prevention is on).
 * Otherwise return the URL unchanged (e.g. /api/uploads/... or external URLs).
 */
export async function getSignedImageUrl(imageUrl: string | null): Promise<string | null> {
  if (!imageUrl || !imageUrl.startsWith(GCS_PUBLIC_PREFIX)) return imageUrl;
  if (!GCS_BUCKET || !GCS_BUCKET.trim()) return imageUrl;
  const prefix = `${GCS_PUBLIC_PREFIX}${GCS_BUCKET}/`;
  if (!imageUrl.startsWith(prefix)) return imageUrl;
  const objectName = imageUrl.slice(prefix.length);
  if (!objectName) return imageUrl;
  try {
    const { Storage } = await import("@google-cloud/storage");
    const storage = new Storage();
    const [url] = await storage
      .bucket(GCS_BUCKET)
      .file(objectName)
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 60 * 60 * 1000, // 1 hour
      });
    return url;
  } catch {
    return imageUrl;
  }
}

/** Returns a copy of the object with imageUrl replaced by a signed URL when applicable. */
export async function withSignedImageUrl<T extends { imageUrl?: string | null }>(obj: T): Promise<T> {
  const url = await getSignedImageUrl(obj.imageUrl ?? null);
  return { ...obj, imageUrl: url ?? obj.imageUrl ?? null };
}
