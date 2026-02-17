import { Router } from "express";
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

