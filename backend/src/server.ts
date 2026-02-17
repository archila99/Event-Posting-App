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

  const app = createApp({ uploadsDir });
  const PORT = process.env.PORT || 3001;

  startReservationExpiryJob();

  await ensureDefaultLocationsAndSlots();

  app.listen(PORT, () => {
    console.log(`Ticket Book API running on http://localhost:${PORT}`);
  });
}

