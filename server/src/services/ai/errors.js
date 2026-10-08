/**
 * Every provider failure is classified into one of these kinds so the
 * AIServiceManager can decide: retry, cool down, disable for good, or move on.
 */
export const AI_ERROR_KINDS = {
  RATE_LIMIT: "RATE_LIMIT", // 429 burst limit - retry later
  QUOTA: "QUOTA", // daily/free-tier quota exhausted - cool down for a long time
  INVALID_KEY: "INVALID_KEY", // bad/revoked key - never retry this key again this run
  TIMEOUT: "TIMEOUT", // request took too long - transient
  UNAVAILABLE: "UNAVAILABLE", // service down / connection refused
  SERVER: "SERVER", // 5xx - transient
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND", // configuration problem
  BAD_REQUEST: "BAD_REQUEST", // our request was rejected - retrying will not help
  NOT_CONFIGURED: "NOT_CONFIGURED",
  BLOCKED: "BLOCKED" // safety filter / empty candidate
};

const RETRYABLE = new Set([AI_ERROR_KINDS.TIMEOUT, AI_ERROR_KINDS.SERVER]);

export class AIProviderError extends Error {
  constructor(kind, message, { provider, status, retryAfterMs } = {}) {
    super(message);
    this.name = "AIProviderError";
    this.kind = kind;
    this.provider = provider;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }

  /** Worth a second attempt on the *same* provider. */
  get retryable() {
    return RETRYABLE.has(this.kind);
  }
}

/** Raised by the manager when every provider in the chain failed. */
export class AIUnavailableError extends Error {
  constructor(message, attempts = []) {
    super(message);
    this.name = "AIUnavailableError";
    this.code = "AI_PROVIDER_UNAVAILABLE";
    this.statusCode = 503;
    this.attempts = attempts;
  }
}

/** Parses Google's "retry in 37s" / RetryInfo hints into milliseconds. */
export function parseRetryAfter(detail = "", header) {
  const fromHeader = Number(header);
  if (Number.isFinite(fromHeader) && fromHeader > 0) return fromHeader * 1000;
  const match = String(detail).match(/retry(?:Delay"?\s*:\s*"|\s+in\s+)(\d+(?:\.\d+)?)s/i);
  return match ? Math.ceil(Number(match[1]) * 1000) : undefined;
}

/**
 * Maps a Gemini HTTP failure to a kind. Google uses:
 *  400 INVALID_ARGUMENT + "API_KEY_INVALID" / "API key not valid" for bad keys
 *  403 PERMISSION_DENIED for disabled or leaked keys
 *  429 RESOURCE_EXHAUSTED for both burst limits and exhausted quotas
 *  404 NOT_FOUND for unknown or retired models
 */
export function classifyGeminiFailure(status, detail = "") {
  const text = String(detail);
  if (status === 400 && /API[_ ]KEY[_ ]INVALID|API key not valid|API key expired/i.test(text)) return AI_ERROR_KINDS.INVALID_KEY;
  if (status === 401 || status === 403) return AI_ERROR_KINDS.INVALID_KEY;
  if (status === 429) {
    return /quota|per day|PerDay|daily|billing/i.test(text) ? AI_ERROR_KINDS.QUOTA : AI_ERROR_KINDS.RATE_LIMIT;
  }
  if (status === 404) return AI_ERROR_KINDS.MODEL_NOT_FOUND;
  if (status === 408 || status === 504) return AI_ERROR_KINDS.TIMEOUT;
  if (status >= 500) return AI_ERROR_KINDS.SERVER;
  return AI_ERROR_KINDS.BAD_REQUEST;
}
