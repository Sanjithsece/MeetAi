import { env } from "../../config/env.js";
import { AI_ERROR_KINDS, AIProviderError } from "./errors.js";

export const OLLAMA_UNAVAILABLE = "Ollama is not running. Start Ollama (`ollama serve`) and try again.";

async function request(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function hasModel(models, model) {
  return models.some((name) => name === model || name === `${model}:latest` || name.startsWith(`${model}:`));
}

/**
 * Local Ollama provider - the default, free and private path. Handles both chat
 * completions (llama3 / codeAI / grammerAI ...) and embeddings (embeddinggemma).
 */
export function createOllamaProvider({
  url = env.ai.ollamaUrl,
  model = env.ai.ollamaModel,
  embeddingModel = env.ai.ollamaEmbeddingModel,
  numCtx = env.ai.ollamaNumCtx,
  timeoutMs = env.ai.ollamaTimeoutMs
} = {}) {
  const baseUrl = String(url).replace(/\/+$/, "");
  const fail = (kind, message, status) => new AIProviderError(kind, message, { provider: "ollama", status });

  async function call(path, body, timeout) {
    let response;
    try {
      response = await request(
        `${baseUrl}${path}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        timeout
      );
    } catch (error) {
      if (error.name === "AbortError") throw fail(AI_ERROR_KINDS.TIMEOUT, `Ollama timed out after ${timeout}ms`);
      throw fail(AI_ERROR_KINDS.UNAVAILABLE, OLLAMA_UNAVAILABLE);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 404) {
        throw fail(AI_ERROR_KINDS.MODEL_NOT_FOUND, `Ollama model "${body.model}" is not available. Run: ollama pull ${body.model}`, 404);
      }
      const kind = response.status >= 500 ? AI_ERROR_KINDS.SERVER : AI_ERROR_KINDS.BAD_REQUEST;
      throw fail(kind, `Ollama request failed (${response.status}): ${detail.slice(0, 300)}`, response.status);
    }
    return response.json();
  }

  return {
    name: "ollama",
    label: "ollama",
    model,
    embeddingModel,
    url: baseUrl,
    isLocal: true,

    async health() {
      try {
        const response = await request(`${baseUrl}/api/tags`);
        if (!response.ok) return { available: false, message: `Ollama responded with ${response.status}` };
        const body = await response.json();
        const models = (body.models ?? []).map((entry) => entry.name);
        const modelReady = hasModel(models, model);
        const embeddingReady = hasModel(models, embeddingModel);
        return {
          available: true,
          models,
          modelReady,
          embeddingModel,
          embeddingReady,
          message: modelReady
            ? `Model ${model} is ready${embeddingReady ? `, embeddings via ${embeddingModel}` : ` (embedding model missing: ollama pull ${embeddingModel})`}`
            : `Ollama is running but ${model} is not pulled. Run: ollama pull ${model}`
        };
      } catch {
        return { available: false, modelReady: false, embeddingReady: false, message: OLLAMA_UNAVAILABLE };
      }
    },

    /**
     * Single-shot completion. `format: "json"` keeps Llama 3 close to valid
     * JSON, and an explicit `num_ctx` stops Ollama silently truncating long
     * transcripts to its small default context window.
     */
    async complete({ system, prompt, json = true, temperature = 0.2 }) {
      const body = await call(
        "/api/generate",
        {
          model,
          system,
          prompt,
          stream: false,
          ...(json ? { format: "json" } : {}),
          options: { temperature, num_ctx: numCtx }
        },
        timeoutMs
      );
      return body.response ?? "";
    },

    /** texts[] -> number[][] using the local embedding model. */
    async embed(texts) {
      const input = Array.isArray(texts) ? texts : [texts];
      if (!input.length) return [];
      const body = await call("/api/embed", { model: embeddingModel, input, truncate: true }, Math.min(timeoutMs, 120000));
      const vectors = body.embeddings ?? [];
      if (vectors.length !== input.length) {
        throw fail(AI_ERROR_KINDS.SERVER, `Ollama returned ${vectors.length} embeddings for ${input.length} inputs`);
      }
      return vectors;
    }
  };
}
