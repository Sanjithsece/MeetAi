import { env } from "../../config/env.js";
import { AI_ERROR_KINDS, AIProviderError, classifyGeminiFailure, parseRetryAfter } from "./errors.js";

const API = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Optional cloud fallback, one instance per API key. The key is sent only in the
 * `x-goog-api-key` header (never in a URL, so it can't leak into proxy/access
 * logs) and is never included in an error message.
 */
export function createGeminiProvider({ apiKey, model = env.ai.geminiModel, label = "gemini", timeoutMs = env.ai.geminiTimeoutMs } = {}) {
  const fail = (kind, message, extra = {}) => new AIProviderError(kind, message, { provider: label, ...extra });

  return {
    name: "gemini",
    label,
    model,
    isLocal: false,

    async health() {
      if (!apiKey) return { available: false, configured: false, message: `${label}: API key is not configured` };
      return { available: true, configured: true, message: `${label} configured with ${model}` };
    },

    async complete({ system, prompt, json = true, temperature = 0.2 }) {
      if (!apiKey) throw fail(AI_ERROR_KINDS.NOT_CONFIGURED, `${label}: API key is not configured`);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          signal: controller.signal,
          body: JSON.stringify({
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature, ...(json ? { responseMimeType: "application/json" } : {}) }
          })
        });
      } catch (error) {
        if (error.name === "AbortError") throw fail(AI_ERROR_KINDS.TIMEOUT, `${label} timed out after ${timeoutMs}ms`);
        throw fail(AI_ERROR_KINDS.UNAVAILABLE, `${label} is unreachable (no internet?)`);
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        const kind = classifyGeminiFailure(response.status, detail);
        let reason = "";
        try {
          reason = JSON.parse(detail)?.error?.message ?? "";
        } catch {
          reason = detail;
        }
        throw fail(kind, `${label} request failed (${response.status} ${kind}): ${String(reason).slice(0, 200)}`, {
          status: response.status,
          retryAfterMs: parseRetryAfter(detail, response.headers.get("retry-after"))
        });
      }

      const body = await response.json();
      const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
      if (!text) {
        const reason = body.promptFeedback?.blockReason ?? body.candidates?.[0]?.finishReason ?? "empty response";
        throw fail(AI_ERROR_KINDS.BLOCKED, `${label} returned no text (${reason})`);
      }
      return text;
    }
  };
}
