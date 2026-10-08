/** Default machine-readable code per HTTP status, used when a throw site sets none. */
const DEFAULT_CODES = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  416: "RANGE_NOT_SATISFIABLE",
  422: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  502: "UPSTREAM_ERROR",
  503: "SERVICE_UNAVAILABLE"
};

export function defaultErrorCode(statusCode) {
  return DEFAULT_CODES[statusCode] ?? (statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED");
}

export class ApiError extends Error {
  constructor(statusCode, message, details, code) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.code = code ?? defaultErrorCode(statusCode);
    this.isOperational = true;
  }
}
