import { env } from "../../config/env.js";
import { aiLogger } from "../../utils/logger.js";
import { getSettings } from "../settingsService.js";
import { getAIManager } from "./aiServiceManager.js";
import { buildAnalysisPrompt, buildChunkPrompt, buildRepairPrompt, CHUNK_SYSTEM_PROMPT, SYSTEM_PROMPT } from "./prompt.js";
import { parseAnalysis } from "./validation.js";

/** The shared manager, built from the effective (Settings-overridable) Ollama config. */
export async function aiManager() {
  const settings = await getSettings().catch(() => ({ ollamaUrl: env.ai.ollamaUrl, ollamaModel: env.ai.ollamaModel }));
  return getAIManager({ ollamaUrl: settings.ollamaUrl, ollamaModel: settings.ollamaModel });
}

async function effectiveMode(override) {
  if (override) return override.toLowerCase();
  const settings = await getSettings().catch(() => ({ aiProvider: env.ai.provider }));
  return (settings.aiProvider ?? env.ai.provider ?? "auto").toLowerCase();
}

export async function aiHealth() {
  const manager = await aiManager();
  const status = await manager.status();
  const mode = await effectiveMode();
  const keys = status.gemini;
  return {
    provider: mode,
    cloudFallback: env.ai.cloudFallback,
    ollama: status.ollama,
    gemini: {
      available: keys.some((key) => !key.state?.disabled),
      configured: keys.length > 0,
      keys,
      model: env.ai.geminiModel,
      message: keys.length
        ? `${keys.length} Gemini key(s) configured (${env.ai.geminiModel}); used ${mode === "gemini" ? "first" : mode === "ollama" ? "never (local-only mode)" : env.ai.cloudFallback ? "only if Ollama fails" : "never (AI_CLOUD_FALLBACK=false)"}`
        : "Gemini: not configured (GEMINI_API_KEY_1 / GEMINI_API_KEY_2 are empty)"
    }
  };
}

/** Splits text on line/sentence boundaries into chunks of at most `size` characters. */
export function splitText(text, size) {
  if (text.length <= size) return [text];
  const chunks = [];
  let rest = text;
  while (rest.length > size) {
    const window = rest.slice(0, size);
    const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(". "));
    const end = cut > size * 0.5 ? cut + 1 : size;
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end);
  }
  if (rest.trim()) chunks.push(rest.trim());
  return chunks;
}

/**
 * Transcript -> structured meeting intelligence.
 *
 * Long transcripts are first condensed part by part (map) and the notes are
 * analysed together (reduce), so nothing is silently cut off by the model's
 * context window. Output is parsed and validated; invalid JSON is retried once
 * with a correction prompt before the step is marked failed.
 */
export async function analyzeTranscript({ meeting, transcript, provider: overrideMode }) {
  const text = (transcript ?? "").trim();
  if (!text) throw new Error("Transcript is empty - nothing to analyse");

  const manager = await aiManager();
  const mode = await effectiveMode(overrideMode);
  const attempts = [];

  let material = text;
  const chunks = splitText(text, env.ai.analysisChunkChars);
  const chunked = chunks.length > 1;

  if (chunked) {
    aiLogger.info("Long transcript - analysing in parts", { meetingId: String(meeting?._id ?? ""), parts: chunks.length, characters: text.length });
    const notes = [];
    for (const [index, chunk] of chunks.entries()) {
      const part = await manager.generate({
        system: CHUNK_SYSTEM_PROMPT,
        prompt: buildChunkPrompt({ title: meeting?.title, index: index + 1, total: chunks.length, text: chunk }),
        json: false,
        purpose: `analysis-part-${index + 1}`,
        mode
      });
      attempts.push(...part.attempts);
      notes.push(`Part ${index + 1}:\n${part.text.trim()}`);
    }
    material = notes.join("\n\n");
  }

  const prompt = buildAnalysisPrompt({
    title: meeting?.title,
    startTime: meeting?.startTime,
    participants: meeting?.participants,
    transcript: material,
    partial: chunked
  });

  aiLogger.info("AI processing started", { meetingId: String(meeting?._id ?? ""), mode, characters: text.length, chunked });

  const first = await manager.generate({ system: SYSTEM_PROMPT, prompt, json: true, purpose: "analysis", mode });
  attempts.push(...first.attempts);
  let answeredBy = first;
  let result = parseAnalysis(first.text);

  if (!result.ok) {
    aiLogger.warn("AI returned unparsable output, retrying with a correction prompt", { reason: result.message, provider: first.label });
    const repaired = await manager.generate({
      system: SYSTEM_PROMPT,
      prompt: buildRepairPrompt(first.text, result.message),
      json: true,
      purpose: "analysis-repair",
      mode
    });
    attempts.push(...repaired.attempts);
    answeredBy = repaired;
    result = parseAnalysis(repaired.text);
  }

  if (!result.ok) {
    throw new Error(`AI output could not be validated: ${result.message}`);
  }

  return {
    ...result.value,
    provider: answeredBy.provider,
    providerLabel: answeredBy.label,
    model: answeredBy.model,
    chunked,
    attempts: attempts.map(({ provider, outcome, kind, message }) => ({ provider, outcome, kind, message: message?.slice(0, 300) }))
  };
}
