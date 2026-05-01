import express, { type NextFunction, type Request, type Response } from "express";
import path from "path";
import cookieParser from "cookie-parser";
import cors from "cors";
import { apiRouter } from "./routes/api.js";

type CreateAppOptions = {
  uploadsDir: string;
  /** When set (e.g. in production), serve frontend static files and SPA fallback */
  frontendDir?: string;
};

export function createApp({ uploadsDir, frontendDir }: CreateAppOptions) {
  const app = express();

  const isProd = process.env.NODE_ENV === "production";
  const frontendUrl = (process.env.FRONTEND_URL || "").trim();
  if (isProd && !frontendUrl) {
    throw new Error("FRONTEND_URL must be set in production for CORS + cookie auth to work.");
  }
  app.use(
    cors({
      origin: (origin, cb) => {
        // Allow non-browser requests (no Origin) like curl, server-to-server, health checks.
        if (!origin) return cb(null, true);
        const allowed = frontendUrl || "http://localhost:5173";
        if (origin === allowed) return cb(null, true);
        return cb(new Error(`CORS blocked origin: ${origin}`));
      },
      credentials: true,
    })
  );
  app.use(cookieParser());
  app.use(express.json());

  // Static endpoint for legacy local uploads (no new uploads are accepted)
  app.use("/api/uploads", express.static(uploadsDir));

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

