import express, { type NextFunction, type Request, type Response } from "express";
import path from "path";
import cors from "cors";
import { apiRouter } from "./routes/api.js";
import { uploadRouter } from "./routes/upload.js";

type CreateAppOptions = {
  uploadsDir: string;
  /** When set (e.g. in production), serve frontend static files and SPA fallback */
  frontendDir?: string;
};

export function createApp({ uploadsDir, frontendDir }: CreateAppOptions) {
  const app = express();

  app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173", credentials: true }));
  app.use(express.json());

  // Static + upload endpoints
  app.use("/api/uploads", express.static(uploadsDir));
  app.use("/api/upload", uploadRouter);

  // Main API router
  app.use("/api", apiRouter);

  // Production: serve built frontend and SPA fallback
  if (frontendDir) {
    const resolvedFrontendDir = path.resolve(frontendDir);
    app.use(express.static(resolvedFrontendDir, { index: false }));
    app.get("*", (req, res, next) => {
      res.sendFile("index.html", { root: resolvedFrontendDir }, (err: unknown) => {
        if (err) next(err);
      });
    });
  }

  // Catch errors and send 500 (avoid sending after headers sent → malformed response)
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[Error]", req.method, req.path, msg, stack || "");
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal Server Error", message: msg });
  });

  return app;
}

