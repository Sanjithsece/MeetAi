import { Router } from "express";
import { env } from "../config/env.js";
import { authController } from "../controllers/authController.js";
import { authenticate } from "../middlewares/auth.js";
import { authLimiter } from "../middlewares/security.js";
import { validate } from "../middlewares/validate.js";
import { authSchemas } from "../validations/schemas.js";
import { ApiError } from "../utils/apiError.js";

export const authRoutes = Router();

/**
 * MeetAI runs as a personal single-user app by default (AUTH_ENABLED=false), so
 * the credential routes are disabled until multi-user mode is turned back on.
 * `/auth/me` always works and returns the local workspace owner.
 */
function requireAuthMode(_req, _res, next) {
  if (!env.auth.enabled) {
    return next(
      new ApiError(
        400,
        "MeetAI is running in local single-user mode. Set AUTH_ENABLED=true in .env to use accounts and passwords."
      )
    );
  }
  return next();
}

authRoutes.post("/register", requireAuthMode, authLimiter, validate(authSchemas.register), authController.register);
authRoutes.post("/login", requireAuthMode, authLimiter, validate(authSchemas.login), authController.login);
authRoutes.post("/refresh", requireAuthMode, authLimiter, validate(authSchemas.refresh), authController.refresh);
authRoutes.post("/logout", requireAuthMode, authenticate, authController.logout);

authRoutes.get("/me", authenticate, authController.me);
