import { env } from "../config/env.js";
import { defaultErrorCode } from "../utils/apiError.js";
import { logger } from "../utils/logger.js";

export function notFound(req, _res, next) {
  const error = new Error(`Route not found: ${req.originalUrl}`);
  error.statusCode = 404;
  error.code = "ROUTE_NOT_FOUND";
  next(error);
}

/** Maps library errors (Mongoose, body-parser, JWT) onto proper HTTP statuses. */
function normalize(error) {
  // body-parser errors already carry a statusCode, so classify them first.
  if (error.type === "entity.parse.failed") {
    return Object.assign(error, { statusCode: 400, code: "INVALID_JSON", message: "Request body is not valid JSON" });
  }
  if (error.type === "entity.too.large") {
    return Object.assign(error, { statusCode: 413, code: "PAYLOAD_TOO_LARGE", message: "Request body is too large" });
  }
  if (error.statusCode) return error;

  if (error.name === "CastError") {
    return Object.assign(error, { statusCode: 400, code: "INVALID_ID", message: `Invalid ${error.path ?? "id"}` });
  }
  if (error.name === "ValidationError" && error.errors) {
    return Object.assign(error, {
      statusCode: 422,
      code: "VALIDATION_FAILED",
      message: "Validation failed",
      details: Object.values(error.errors).map((item) => ({ field: item.path, message: item.message }))
    });
  }
  if (error.code === 11000) {
    return Object.assign(error, { statusCode: 409, code: "DUPLICATE", message: "A record with this value already exists" });
  }
  if (["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"].includes(error.name)) {
    return Object.assign(error, { statusCode: 401, code: error.name === "TokenExpiredError" ? "TOKEN_EXPIRED" : "INVALID_TOKEN" });
  }
  if (error.status && error.status < 500) error.statusCode = error.status;
  return error;
}

/**
 * Single error exit for the API. Every failure has the same shape:
 *   { success:false, message, error:{ code, message, details? } }
 * `message` is kept at the top level for older clients. Stack traces only go to
 * the local log files, never into a response.
 */
export function errorHandler(rawError, req, res, _next) {
  const error = normalize(rawError);
  const statusCode = error.statusCode || 500;
  const code = typeof error.code === "string" ? error.code : defaultErrorCode(statusCode);
  const message = statusCode >= 500 ? "Internal server error" : error.message;

  const log = statusCode >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
  log(error.message, {
    status: statusCode,
    code,
    method: req.method,
    path: req.originalUrl,
    ...(statusCode >= 500 ? { stack: error.stack } : {}),
    ...(error.details ? { details: error.details } : {})
  });

  if (res.headersSent) return;

  res.status(statusCode).json({
    success: false,
    message,
    error: {
      code,
      message,
      ...(error.details ? { details: error.details } : {}),
      ...(env.nodeEnv === "development" && statusCode >= 500 ? { hint: "See logs/error.log for details" } : {})
    },
    ...(error.details ? { details: error.details } : {})
  });
}
