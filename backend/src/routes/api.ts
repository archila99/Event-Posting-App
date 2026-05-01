import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authRouter } from "./auth.js";
import { usersRouter } from "./users.js";
import { locationsRouter } from "./locations.js";
import { timeSlotsRouter } from "./timeSlots.js";
import { eventsRouter } from "./events.js";
import { reservationsRouter } from "./reservations.js";
import { ticketsRouter } from "./tickets.js";
import { adminRouter } from "./admin.js";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/locations", locationsRouter);
apiRouter.use("/time-slots", timeSlotsRouter);
apiRouter.use("/events", eventsRouter);
apiRouter.use("/reservations", reservationsRouter);
apiRouter.use("/tickets", ticketsRouter);
apiRouter.use("/admin", adminRouter);

apiRouter.get("/health", (_req, res) => res.json({ ok: true }));

apiRouter.get("/health/db", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ ok: true, db: "connected" });
  } catch (e) {
    console.error("[health/db]", e instanceof Error ? e.message : e);
    return res.status(503).json({ ok: false, db: "error", message: (e instanceof Error ? e.message : String(e)).slice(0, 100) });
  }
});

apiRouter.get("/health/storage", (_req, res) => {
  res.json({
    ok: true,
    message: "Event images are served from /api/uploads for local disk storage. Configure external storage separately if needed.",
  });
});

// 404 for API: so we see path/method when a route is missing (e.g. old deployment)
apiRouter.use((req, res) => {
  res.status(404).json({ error: "Not Found", path: req.path, method: req.method });
});

