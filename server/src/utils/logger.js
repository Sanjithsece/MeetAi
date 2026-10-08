import path from "node:path";
import winston from "winston";
import { env } from "../config/env.js";
import { ensureStorageDirectories } from "../config/paths.js";

ensureStorageDirectories();

/**
 * Structured logging for the whole meeting lifecycle. Credentials, OAuth tokens
 * and API keys are never passed to the logger - `redact()` is the single place
 * that scrubs anything that slips through.
 */
const SECRET_KEYS = /^(password|pass|token|access_token|refresh_token|refreshToken|accessToken|apiKey|api_key|key|authorization|client_secret|clientSecret|secret)$/i;

/**
 * Secret-shaped substrings that could reach a log line through an upstream
 * error message: Google API keys, Notion secrets, bearer tokens, JWTs and
 * `key=` query parameters.
 */
const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{20,}/g,
  /\b(?:ntn|secret)_[0-9A-Za-z]{20,}/g,
  /Bearer\s+[0-9A-Za-z._~+/-]{12,}=*/gi,
  /eyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}/g,
  /([?&](?:key|api_key|token)=)[^&\s]+/gi
];

export function scrubSecrets(text) {
  if (typeof text !== "string") return text;
  return SECRET_PATTERNS.reduce(
    // Only the `key=` pattern has a capture group; keep its "?key=" prefix.
    (current, pattern) => current.replace(pattern, (_match, prefix) => (typeof prefix === "string" ? `${prefix}[redacted]` : "[redacted]")),
    text
  );
}

function redact(value, depth = 0) {
  if (typeof value === "string") return scrubSecrets(value);
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, SECRET_KEYS.test(key) ? "[redacted]" : redact(item, depth + 1)])
  );
}

/**
 * Mutates the record in place. Returning a new object (as this used to) drops
 * winston's Symbol(level)/Symbol(message) properties, and then every transport
 * silently discards the line - no log file was ever written because of that.
 */
const redactFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (key === "level" || key === "timestamp") continue;
    if (key === "message" || key === "stack") info[key] = scrubSecrets(info[key]);
    else info[key] = SECRET_KEYS.test(key) ? "[redacted]" : redact(info[key]);
  }
  return info;
});

/** Routes a log record to a per-area file when it carries that `category`. */
const onlyCategory = (category) => winston.format((info) => (info.category === category ? info : false))();

/** Test runs must not print noise or append to the user's real log files. */
const testing = Boolean(process.env.VITEST);

export const logger = winston.createLogger({
  level: env.nodeEnv === "production" ? "info" : "debug",
  silent: testing,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    redactFormat(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
          return `${timestamp} ${level} ${message}${rest}`;
        })
      )
    }),
    new winston.transports.File({ filename: path.join(env.paths.logs, "meetai.log"), maxsize: 5_000_000, maxFiles: 5 }),
    new winston.transports.File({ filename: path.join(env.paths.logs, "error.log"), level: "error", maxsize: 5_000_000, maxFiles: 3 }),
    new winston.transports.File({
      filename: path.join(env.paths.logs, "ai.log"),
      format: winston.format.combine(onlyCategory("ai"), winston.format.json()),
      maxsize: 5_000_000,
      maxFiles: 3
    }),
    new winston.transports.File({
      filename: path.join(env.paths.logs, "meeting.log"),
      format: winston.format.combine(onlyCategory("meeting"), winston.format.json()),
      maxsize: 5_000_000,
      maxFiles: 3
    })
  ]
});

/** Everything also lands in meetai.log; these additionally fill ai.log / meeting.log. */
export const aiLogger = logger.child({ category: "ai" });
export const meetingLogger = logger.child({ category: "meeting" });

/** Named lifecycle events - used by the pipeline so logs stay greppable. */
export function logEvent(event, meta = {}) {
  logger.info(event, meta);
}
