import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { userRepository } from "../repositories/userRepository.js";
import { getLocalUser } from "../services/localUserService.js";
import { ApiError } from "../utils/apiError.js";

export async function authenticate(req, _res, next) {
  try {
    if (!env.auth.enabled) {
      req.user = await getLocalUser();
      return next();
    }

    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new ApiError(401, "Authentication token required");
    }

    const token = header.split(" ")[1];
    const payload = jwt.verify(token, env.auth.jwtAccessSecret);
    const user = await userRepository.findById(payload.sub).select("-passwordHash -refreshTokenHash");
    if (!user || user.status !== "ACTIVE") {
      throw new ApiError(401, "Invalid or inactive user session");
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(error.statusCode ? error : new ApiError(401, "Invalid authentication token"));
  }
}

export function authorize(...roles) {
  return (req, _res, next) => {
    if (!env.auth.enabled) return next();
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError(403, "You do not have permission to perform this action"));
    }
    return next();
  };
}
