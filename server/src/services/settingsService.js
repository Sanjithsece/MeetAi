import { env } from "../config/env.js";
import { Setting } from "../models/Setting.js";

let cached = null;

async function loadDocument() {
  if (cached) return cached;
  cached = (await Setting.findOne({ key: "local" })) ?? (await Setting.create({ key: "local" }));
  return cached;
}

function pick(override, fallback) {
  return override === null || override === undefined || override === "" ? fallback : override;
}

/**
 * Effective runtime configuration: `.env` provides the defaults and the
 * Settings page may override the non-secret ones. Secrets (API keys, OAuth
 * credentials) are intentionally never overridable from the database.
 */
export async function getSettings() {
  const doc = await loadDocument();
  return {
    aiProvider: pick(doc.aiProvider, env.ai.provider),
    ollamaUrl: pick(doc.ollamaUrl, env.ai.ollamaUrl),
    ollamaModel: pick(doc.ollamaModel, env.ai.ollamaModel),
    whisperImplementation: pick(doc.whisperImplementation, env.whisper.implementation),
    whisperModel: pick(doc.whisperModel, env.whisper.model),
    whisperLanguage: pick(doc.whisperLanguage, env.whisper.language),
    joinOffsetMinutes: pick(doc.joinOffsetMinutes, env.meeting.joinOffsetMinutes),
    schedulerEnabled: doc.schedulerEnabled === null || doc.schedulerEnabled === undefined ? env.meeting.schedulerEnabled : doc.schedulerEnabled,
    autoProcessAfterRecording: doc.autoProcessAfterRecording !== false,
    createTasksFromActionItems: doc.createTasksFromActionItems !== false,
    recorderAudioDevice: pick(doc.recorderAudioDevice, env.recorder.audioDevice),
    meetingDisplayName: pick(doc.meetingDisplayName, env.meeting.displayName),
    joinRetries: Number(process.env.MEETING_JOIN_RETRIES ?? 10),
    joinRetryDelaySeconds: Number(process.env.MEETING_JOIN_RETRY_DELAY_SECONDS ?? 30),
    lobbyMaxMinutes: Number(process.env.MEETING_LOBBY_MAX_MINUTES ?? 15),
    // Presence flags only - key values never leave the backend.
    geminiConfigured: env.ai.geminiApiKeys.length > 0,
    geminiKeyCount: env.ai.geminiApiKeys.length,
    geminiModel: env.ai.geminiModel,
    cloudFallback: env.ai.cloudFallback,
    embeddingModel: env.ai.ollamaEmbeddingModel,
    ragEnabled: env.rag.enabled,
    ragStore: env.rag.chromaUrl ? "chromadb" : "mongodb",
    ragAllowCloud: env.rag.allowCloud,
    emailConfigured: Boolean(env.email.host && env.email.user && env.email.password),
    emailDefaultRecipient: Boolean(env.email.to),
    notionConfigured: Boolean(env.notion.token && env.notion.databaseId),
    gmailConfigured: Boolean(env.gmail.clientId && env.gmail.clientSecret),
    recordingDir: env.paths.recordings,
    transcriptDir: env.paths.transcripts,
    meetingNotesDir: env.paths.meetingNotes,
    browserProfileDir: env.paths.browserProfile
  };
}

export async function updateSettings(patch) {
  const doc = await loadDocument();
  Object.assign(doc, patch);
  await doc.save();
  cached = doc;
  return getSettings();
}

export function resetSettingsCache() {
  cached = null;
}
