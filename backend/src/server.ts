import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createApp } from "./app.js";
import { ensureDefaultLocationsAndSlots } from "./lib/ensureDefaults.js";
import { startReservationExpiryJob } from "./jobs/expireReservations.js";

export async function startServer() {
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
  const app = createApp({
    uploadsDir,
    frontendDir: hasFrontend ? frontendDir : undefined,
  });
  const PORT = Number(process.env.PORT) || 3001;

  startReservationExpiryJob();

  // Listen immediately so Cloud Run sees the container as ready (then run DB init in background)
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Ticket Book API running on port ${PORT}`);
    ensureDefaultLocationsAndSlots().catch((err) =>
      console.error("[ensureDefaults]", err)
    );
  });
}

