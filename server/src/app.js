import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import morgan from "morgan";
import { env } from "./config/env.js";
import { applySecurity } from "./middlewares/security.js";
import { errorHandler, notFound } from "./middlewares/errorHandler.js";
import { apiRouter } from "./routes/index.js";
import { setupSwagger } from "./swagger.js";
import { logger } from "./utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.resolve(__dirname, "../../dist");

export function createApp() {
  const app = express();
  applySecurity(app);
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    morgan("tiny", {
      stream: { write: (message) => logger.http?.(message.trim()) ?? logger.debug(message.trim()) },
      skip: (req) => req.path === "/health"
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ success: true, status: "ok", service: "MeetAI API", mode: env.auth.enabled ? "multi-user" : "local-single-user" });
  });

  setupSwagger(app);
  app.use("/api/v1", apiRouter);

  // The built React app is served from the same origin in production builds.
  app.use(express.static(clientDistPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    return res.sendFile(path.join(clientDistPath, "index.html"), (error) => (error ? next() : undefined));
  });

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
