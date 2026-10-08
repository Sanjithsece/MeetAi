import compression from "compression";
import cors from "cors";
import helmet from "helmet";
import hpp from "hpp";
import mongoSanitize from "express-mongo-sanitize";
import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";
import { ApiError } from "../utils/apiError.js";

/** Brute-force guard for the credential endpoints (login/register/refresh). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 20),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(new ApiError(429, "Too many authentication attempts. Try again in 15 minutes.", undefined, "RATE_LIMITED"))
});

/**
 * Localhost-only hardening. The API is not meant to be exposed to a network, so
 * CORS is restricted to the local Vite dev server and the same origin.
 */
export function applySecurity(app) {
  app.use(
    helmet({
      // The dashboard is served from the same origin; Swagger UI needs inline
      // styles, and the video element streams from this origin.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "same-site" },
      crossOriginEmbedderPolicy: false
    })
  );

  const allowedOrigins = new Set([env.clientUrl, "http://localhost:5173", "http://127.0.0.1:5173"]);
  app.use(
    cors({
      origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
      credentials: true
    })
  );

  app.use(compression());
  app.use(mongoSanitize());
  app.use(hpp());
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 2000,
      standardHeaders: true,
      legacyHeaders: false,
      // Streaming a recording issues many range requests - never throttle those.
      skip: (req) => req.path.endsWith("/recording"),
      handler: (_req, _res, next) => next(new ApiError(429, "Too many requests, slow down.", undefined, "RATE_LIMITED"))
    })
  );
}
