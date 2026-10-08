import { env } from "../../config/env.js";
import { aiLogger } from "../../utils/logger.js";
import { AI_ERROR_KINDS, AIProviderError, AIUnavailableError } from "./errors.js";
import { createGeminiProvider } from "./geminiProvider.js";
import { createOllamaProvider } from "./ollamaProvider.js";

/** How long a provider is skipped after each kind of failure. */
const COOLDOWN_MS = {
  [AI_ERROR_KINDS.RATE_LIMIT]: 60_000,
  [AI_ERROR_KINDS.QUOTA]: 60 * 60_000,
  [AI_ERROR_KINDS.UNAVAILABLE]: 15_000,
  [AI_ERROR_KINDS.MODEL_NOT_FOUND]: 5 * 60_000
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * AIServiceManager - the only place that decides *which* model answers.
 *
 *   auto   : Ollama -> Gemini key 1 -> Gemini key 2 -> AI_PROVIDER_UNAVAILABLE
 *   ollama : Ollama only (nothing leaves the machine)
 *   gemini : Gemini key 1 -> Gemini key 2 -> Ollama
 *
 * Failures are classified (see errors.js): timeouts and 5xx are retried on the
 * same provider; 429/quota put that key on a cooldown; an invalid key is
 * disabled for the rest of the process so it is never hammered again.
 */
export class AIServiceManager {
  constructor({ ollama, geminiKeys = env.ai.geminiApiKeys, geminiModel = env.ai.geminiModel, maxRetries = env.ai.maxRetries, now = () => Date.now(), retryDelayMs = 1000 } = {}) {
    this.ollama = ollama ?? createOllamaProvider();
    this.gemini = geminiKeys
      .filter(Boolean)
      .map((apiKey, index) => createGeminiProvider({ apiKey, model: geminiModel, label: `gemini-key-${index + 1}` }));
    this.maxRetries = maxRetries;
    this.now = now;
    this.retryDelayMs = retryDelayMs;
    /** label -> { disabled, until, kind, message, at } */
    this.state = new Map();
  }

  /** Provider order for a request. `allowCloud=false` removes Gemini entirely. */
  chain({ mode = env.ai.provider, allowCloud = true, cloudFallback = env.ai.cloudFallback } = {}) {
    const cloud = allowCloud ? this.gemini : [];
    switch (mode) {
      case "ollama":
        return [this.ollama];
      case "gemini":
        return [...cloud, this.ollama];
      default:
        return cloudFallback ? [this.ollama, ...cloud] : [this.ollama];
    }
  }

  skipReason(provider) {
    const entry = this.state.get(provider.label);
    if (!entry) return null;
    if (entry.disabled) return `disabled (${entry.kind}): ${entry.message}`;
    if (entry.until && entry.until > this.now()) {
      return `cooling down for ${Math.ceil((entry.until - this.now()) / 1000)}s after ${entry.kind}`;
    }
    return null;
  }

  recordFailure(provider, error) {
    const kind = error.kind ?? AI_ERROR_KINDS.SERVER;
    const base = { kind, message: error.message, at: new Date(this.now()).toISOString() };
    if (kind === AI_ERROR_KINDS.INVALID_KEY || kind === AI_ERROR_KINDS.NOT_CONFIGURED) {
      this.state.set(provider.label, { ...base, disabled: true });
      return;
    }
    const cooldown = error.retryAfterMs ?? COOLDOWN_MS[kind];
    this.state.set(provider.label, { ...base, disabled: false, until: cooldown ? this.now() + cooldown : undefined });
  }

  /**
   * Runs `operation(provider)` against the chain until one succeeds.
   * Returns `{ result, provider, model, attempts }`.
   */
  async run(operation, { purpose = "completion", mode, allowCloud = true, cloudFallback } = {}) {
    const chain = this.chain({ mode, allowCloud, cloudFallback });
    const attempts = [];

    for (const provider of chain) {
      const skipped = this.skipReason(provider);
      if (skipped) {
        attempts.push({ provider: provider.label, outcome: "skipped", reason: skipped });
        continue;
      }

      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
        try {
          aiLogger.info("AI provider selected", { purpose, provider: provider.label, model: provider.model, attempt: attempt + 1 });
          const result = await operation(provider);
          this.state.delete(provider.label);
          if (attempts.length) {
            aiLogger.warn("AI provider fallback succeeded", { purpose, provider: provider.label, previous: attempts });
          }
          attempts.push({ provider: provider.label, outcome: "success" });
          return { result, provider: provider.name, label: provider.label, model: provider.model, attempts };
        } catch (rawError) {
          const error =
            rawError instanceof AIProviderError
              ? rawError
              : new AIProviderError(AI_ERROR_KINDS.SERVER, rawError.message, { provider: provider.label });
          const willRetry = error.retryable && attempt < this.maxRetries;
          attempts.push({ provider: provider.label, outcome: willRetry ? "retrying" : "failed", kind: error.kind, message: error.message });
          aiLogger.warn(willRetry ? "AI provider failed, retrying" : "AI provider failed, falling back", {
            purpose,
            provider: provider.label,
            kind: error.kind,
            error: error.message
          });
          if (willRetry) {
            await sleep(this.retryDelayMs * (attempt + 1));
            continue;
          }
          this.recordFailure(provider, error);
          break;
        }
      }
    }

    const summary = attempts.filter((item) => item.outcome !== "success").map((item) => `${item.provider}: ${item.reason ?? item.message}`).join(" | ");
    aiLogger.error("All AI providers failed", { purpose, attempts });
    throw new AIUnavailableError(`AI service is currently unavailable. ${summary}`.trim(), attempts);
  }

  /** Text/JSON completion through the fallback chain. */
  async generate({ system, prompt, json = true, purpose, mode, allowCloud = true }) {
    const outcome = await this.run((provider) => provider.complete({ system, prompt, json }), { purpose, mode, allowCloud });
    return { text: outcome.result, provider: outcome.provider, label: outcome.label, model: outcome.model, attempts: outcome.attempts };
  }

  /** Embeddings are always local: vectors from different models are not comparable. */
  async embed(texts) {
    return this.ollama.embed(texts);
  }

  async status() {
    const ollama = await this.ollama.health();
    return {
      mode: env.ai.provider,
      cloudFallback: env.ai.cloudFallback,
      ollama: { ...ollama, model: this.ollama.model, url: this.ollama.url, state: this.state.get("ollama") ?? null },
      gemini: this.gemini.map((provider) => ({
        label: provider.label,
        model: provider.model,
        configured: true,
        state: this.state.get(provider.label) ?? null,
        skipped: this.skipReason(provider)
      }))
    };
  }

  reset() {
    this.state.clear();
  }
}

let shared = null;
let sharedKey = "";

/**
 * Process-wide manager. Rebuilt only when the Ollama URL/model change in
 * Settings so key cooldown/blacklist state survives between requests.
 */
export function getAIManager({ ollamaUrl = env.ai.ollamaUrl, ollamaModel = env.ai.ollamaModel } = {}) {
  const key = `${ollamaUrl}|${ollamaModel}`;
  if (!shared || key !== sharedKey) {
    shared = new AIServiceManager({ ollama: createOllamaProvider({ url: ollamaUrl, model: ollamaModel }) });
    sharedKey = key;
  }
  return shared;
}
