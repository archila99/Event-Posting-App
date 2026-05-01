import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createApp } from "./app.js";
import { ensureDefaultLocationsAndSlots } from "./lib/ensureDefaults.js";
import { startReservationExpiryJob } from "./jobs/expireReservations.js";
import dotenv from "dotenv";
import { prisma } from "./lib/prisma.js";

export async function startServer() {
  console.log("[server] SERVER STARTING");
  try {
    // In production (Render), env vars are injected by the platform.
    // In local dev, src/index.ts loads backend/.env; this is a no-op if already loaded.
    dotenv.config();

    const nodeEnv = process.env.NODE_ENV || "development";
    const hasDbUrl = !!(process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim());
    const frontendUrl = (process.env.FRONTEND_URL || "").trim();
    const hasAccessSecret = !!(process.env.JWT_ACCESS_SECRET || process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET);
    const hasRefreshSecret = !!(process.env.JWT_REFRESH_SECRET || process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET);

    console.log("[server] ENV NODE_ENV:", nodeEnv);
    console.log("[server] ENV DATABASE_URL set:", hasDbUrl);
    console.log("[server] ENV FRONTEND_URL:", frontendUrl || "(empty)");
    console.log("[server] ENV JWT access secret set:", hasAccessSecret);
    console.log("[server] ENV JWT refresh secret set:", hasRefreshSecret);

    // Hard-fail early with clear error (avoids Render "exited early" without context).
    if (!hasDbUrl) throw new Error("Missing required env: DATABASE_URL");
    if (nodeEnv === "production" && !frontendUrl) throw new Error("Missing required env in production: FRONTEND_URL");
    if (!hasAccessSecret) throw new Error("Missing required env: JWT_ACCESS_SECRET (or ACCESS_TOKEN_SECRET/JWT_SECRET fallback)");
    if (!hasRefreshSecret) throw new Error("Missing required env: JWT_REFRESH_SECRET (or REFRESH_TOKEN_SECRET/JWT_SECRET fallback)");

    console.log("[server] Prisma connecting...");
    await prisma.$connect();
    console.log("[server] Prisma connected");

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const uploadsDir = path.join(__dirname, "..", "uploads");
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const frontendDir =
      process.env.NODE_ENV === "production"
        ? path.resolve(__dirname, "..", "public")
        : undefined;
    const hasFrontend = frontendDir && fs.existsSync(frontendDir);
    if (frontendDir && !hasFrontend) {
      console.warn("[server] Frontend dir not found, serving API only:", frontendDir);
    }

    console.log("[server] Creating app...");
    const app = createApp({
      uploadsDir,
      frontendDir: hasFrontend ? frontendDir : undefined,
    });

    const PORT = Number(process.env.PORT) || 3001;
    console.log("[server] Binding port:", PORT);

    startReservationExpiryJob();

    // Listen immediately (then run DB init in background)
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`[server] SERVER RUNNING on port ${PORT}`);
      ensureDefaultLocationsAndSlots().catch((err) =>
        console.error("[ensureDefaults]", err)
      );
    });
  } catch (err) {
    console.error("[server] STARTUP FAILED:", err);
    process.exit(1);
  }
}

