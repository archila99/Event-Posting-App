import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { apiRouter } from "./routes/api.js";
import { uploadRouter } from "./routes/upload.js";

type CreateAppOptions = {
  uploadsDir: string;
};

export function createApp({ uploadsDir }: CreateAppOptions) {
  const app = express();

  app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173", credentials: true }));
  app.use(express.json());

  // Static + upload endpoints
  app.use("/api/uploads", express.static(uploadsDir));
  app.use("/api/upload", uploadRouter);

  // Main API router
  app.use("/api", apiRouter);

  // Catch errors and send 500 with message
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Internal Server Error", message });
  });

  return app;
}

