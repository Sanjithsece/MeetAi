import mongoose from "mongoose";
import { env } from "../../config/env.js";
import { aiHealth } from "../ai/index.js";
import { browserProfileStatus } from "../automation/meetBot.js";
import { gmailStatus } from "../gmail/oauthClient.js";
import { emailStatus } from "../mailService.js";
import { notionStatus } from "../notion/notionService.js";
import { ragStatus } from "../rag/ragService.js";
import { recorderHealth } from "../recording/recorder.js";
import { schedulerState } from "../scheduler/meetingScheduler.js";
import { whisperHealth } from "../transcription/whisper.js";
import { queueDepth } from "../pipeline/jobQueue.js";

const MONGO_STATES = ["disconnected", "connected", "connecting", "disconnecting"];

function mongoStatus() {
  const state = mongoose.connection.readyState;
  return {
    available: state === 1,
    state: MONGO_STATES[state] ?? "unknown",
    uri: env.mongodbUri.replace(/\/\/[^@]*@/, "//"),
    message: state === 1 ? "MongoDB connected" : `MongoDB is ${MONGO_STATES[state] ?? "unavailable"} - start your local mongod`
  };
}

/** Never lets one slow/broken integration take the whole status board down. */
async function safe(promise, fallbackMessage) {
  try {
    return await promise;
  } catch (error) {
    return { available: false, configured: false, message: `${fallbackMessage}: ${error.message}` };
  }
}

/**
 * One call powering the Settings page status board. Anything that needs the
 * network (Gmail, Notion, Gemini, SMTP) is optional and reported as
 * "not configured" rather than as an error.
 */
export async function getSystemStatus({ includeBrowser = false, owner } = {}) {
  const [ai, whisper, recorder, notion, gmail, rag, email] = await Promise.all([
    safe(aiHealth(), "AI status failed"),
    safe(whisperHealth(), "Whisper check failed"),
    safe(recorderHealth(), "Recorder check failed"),
    safe(notionStatus(), "Notion check failed"),
    safe(gmailStatus(), "Gmail check failed"),
    safe(ragStatus(owner), "RAG check failed"),
    safe(emailStatus(), "Email check failed")
  ]);

  const browser = includeBrowser ? await safe(browserProfileStatus(), "Browser check failed") : null;

  return {
    mongodb: mongoStatus(),
    ollama: {
      ...(ai.ollama ?? {}),
      url: ai.ollama?.url ?? env.ai.ollamaUrl,
      model: ai.ollama?.model ?? env.ai.ollamaModel,
      isDefaultProvider: ai.provider !== "gemini"
    },
    gemini: {
      ...(ai.gemini ?? {}),
      enabled: ai.provider === "gemini" || (ai.provider === "auto" && env.ai.cloudFallback),
      configured: env.ai.geminiApiKeys.length > 0
    },
    aiProvider: ai.provider,
    cloudFallback: env.ai.cloudFallback,
    whisper,
    recorder,
    ffmpeg: recorder.ffmpeg ?? { available: false, message: recorder.message },
    rag,
    email,
    notion,
    gmail,
    ...(browser ? { browserProfile: browser } : {}),
    scheduler: schedulerState(),
    jobs: { queued: queueDepth() },
    offline: {
      worksOffline: ["React UI", "Express API", "MongoDB", "Recordings", "Whisper", "Ollama", "Embeddings", "RAG search", "Tasks", "Analytics"],
      needsInternet: ["Google Meet", "Gmail", "Notion", "Email (SMTP)", "Gemini fallback (optional)"]
    }
  };
}
