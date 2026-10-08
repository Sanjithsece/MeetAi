import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repository root - every relative storage path is resolved against it. */
export const projectRoot = path.resolve(__dirname, "../../..");

// Load the root .env no matter which directory the process was started from.
dotenv.config({ path: path.join(projectRoot, ".env") });

function resolvePath(value, fallback) {
  return path.resolve(projectRoot, value || fallback);
}

function bool(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
}

function num(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** First non-empty value among the given env names (new name first, legacy aliases after). */
function first(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  return "";
}

/**
 * Notion shows database links like https://www.notion.so/Name-3792a6ee77ff80d29481f1287d59ea98?v=...
 * The API only accepts the 32-hex id, so pull it out of a pasted URL.
 */
export function normalizeNotionId(value = "") {
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  const withoutQuery = trimmed.split("?")[0];
  const dashed = withoutQuery.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (dashed) return dashed[0].replace(/-/g, "").toLowerCase();
  const plain = withoutQuery.match(/[0-9a-f]{32}(?![0-9a-f])/i);
  return plain ? plain[0].toLowerCase() : trimmed;
}

const authEnabled = bool(process.env.AUTH_ENABLED, false);
const jwtAccessSecret = first("JWT_SECRET", "JWT_ACCESS_SECRET");

if (authEnabled && !jwtAccessSecret) {
  throw new Error("AUTH_ENABLED=true requires JWT_SECRET to be set in .env");
}

// A separate refresh secret is optional: derive a distinct one so the access
// secret can never verify a refresh token (or the other way round).
const jwtRefreshSecret =
  first("JWT_REFRESH_SECRET") ||
  (jwtAccessSecret ? crypto.createHash("sha256").update(`${jwtAccessSecret}:refresh`).digest("hex") : "");

const geminiKeys = [first("GEMINI_API_KEY_1", "GEMINI_API_KEY"), first("GEMINI_API_KEY_2")].filter(Boolean);

const emailHost = first("EMAIL_HOST", "SMTP_HOST");
const emailPort = num(first("EMAIL_PORT", "SMTP_PORT"), 587);

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: num(process.env.PORT, 5000),
  /** 127.0.0.1 keeps the API private to this computer. Only use 0.0.0.0 with AUTH_ENABLED=true. */
  host: process.env.HOST || "127.0.0.1",
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  mongodbUri: first("MONGODB_URI") || "mongodb://127.0.0.1:27017/meetai",

  ai: {
    /** auto = Ollama first, Gemini keys as fallback | ollama = local only | gemini = Gemini first, Ollama fallback */
    provider: (first("AI_PROVIDER") || "auto").toLowerCase(),
    /** When false, nothing is ever sent to Gemini automatically - Ollama failures surface as errors. */
    cloudFallback: bool(process.env.AI_CLOUD_FALLBACK, true),
    maxRetries: Math.max(0, num(process.env.AI_MAX_RETRIES, 1)),
    ollamaUrl: (first("OLLAMA_BASE_URL", "OLLAMA_URL") || "http://localhost:11434").replace(/\/+$/, ""),
    ollamaModel: first("OLLAMA_CHAT_MODEL", "OLLAMA_MODEL") || "llama3",
    ollamaEmbeddingModel: first("OLLAMA_EMBEDDING_MODEL") || "embeddinggemma",
    ollamaNumCtx: num(process.env.OLLAMA_NUM_CTX, 8192),
    ollamaTimeoutMs: num(process.env.OLLAMA_TIMEOUT_MS, 300000),
    geminiApiKeys: geminiKeys,
    // gemini-2.0-flash was shut down by Google; the alias tracks the current Flash model.
    geminiModel: first("GEMINI_MODEL") || "gemini-flash-latest",
    geminiTimeoutMs: num(process.env.GEMINI_TIMEOUT_MS, 60000),
    /** Characters per analysis chunk before a transcript is summarised in parts. */
    analysisChunkChars: num(process.env.AI_ANALYSIS_CHUNK_CHARS, 12000)
  },

  rag: {
    enabled: bool(process.env.RAG_ENABLED, true),
    chromaUrl: first("CHROMA_URL").replace(/\/+$/, ""),
    chromaCollection: first("CHROMA_COLLECTION") || "meetai",
    chromaTenant: first("CHROMA_TENANT") || "default_tenant",
    chromaDatabase: first("CHROMA_DATABASE") || "default_database",
    chunkSize: num(process.env.RAG_CHUNK_SIZE, 1200),
    chunkOverlap: num(process.env.RAG_CHUNK_OVERLAP, 200),
    topK: num(process.env.RAG_TOP_K, 5),
    /** Private meeting context goes to Gemini only when this is explicitly true. */
    allowCloud: bool(process.env.RAG_ALLOW_CLOUD, false)
  },

  whisper: {
    implementation: (process.env.WHISPER_IMPLEMENTATION || "auto").toLowerCase(),
    model: process.env.WHISPER_MODEL || "base",
    language: process.env.WHISPER_LANGUAGE ?? "en",
    device: (process.env.WHISPER_DEVICE || "cpu").toLowerCase(),
    python: process.env.WHISPER_PYTHON || "",
    cppBinary: process.env.WHISPER_CPP_BINARY || "",
    cppModelPath: process.env.WHISPER_CPP_MODEL_PATH || ""
  },

  media: {
    ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
    ffprobePath: process.env.FFPROBE_PATH || "ffprobe"
  },

  recorder: {
    mode: (process.env.RECORDER || "auto").toLowerCase(),
    audioDevice: process.env.RECORDER_AUDIO_DEVICE || "",
    frameRate: num(process.env.RECORDER_FRAMERATE, 15),
    allowVideoOnly: bool(process.env.RECORDER_ALLOW_VIDEO_ONLY, false),
    maxMinutes: num(process.env.RECORDER_MAX_MINUTES, 180)
  },

  paths: {
    recordings: resolvePath(process.env.RECORDING_DIR, "./recordings"),
    transcripts: resolvePath(process.env.TRANSCRIPT_DIR, "./transcripts"),
    meetingNotes: resolvePath(process.env.MEETING_NOTES_DIR, "./meeting-notes"),
    browserProfile: resolvePath(process.env.BROWSER_PROFILE_DIR, "./browser-profile"),
    logs: resolvePath(process.env.LOG_DIR, "./logs"),
    secrets: resolvePath(process.env.SECRETS_DIR, "./.secrets")
  },

  meeting: {
    joinOffsetMinutes: num(process.env.MEETING_JOIN_OFFSET_MINUTES, 2),
    schedulerEnabled: bool(process.env.MEETING_SCHEDULER_ENABLED, true),
    schedulerIntervalSeconds: num(process.env.MEETING_SCHEDULER_INTERVAL_SECONDS, 30),
    headless: bool(process.env.PLAYWRIGHT_HEADLESS, false),
    displayName: process.env.MEETING_DISPLAY_NAME || "MeetAI",
    /** chrome | msedge | chromium - tried first, the others are fallbacks. */
    browserChannel: (process.env.PLAYWRIGHT_BROWSER_CHANNEL || "chrome").toLowerCase()
  },

  gmail: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI || "http://localhost:5000/api/v1/integrations/gmail/callback",
    syncEnabled: bool(process.env.GMAIL_SYNC_ENABLED, false),
    syncIntervalMinutes: num(process.env.GMAIL_SYNC_INTERVAL_MINUTES, 15),
    lookbackDays: num(process.env.GMAIL_LOOKBACK_DAYS, 14)
  },

  notion: {
    token: first("NOTION_API_KEY", "NOTION_TOKEN"),
    databaseId: normalizeNotionId(first("NOTION_DATABASE_ID", "NOTION_MEETINGS_DATABASE_ID"))
  },

  auth: {
    enabled: authEnabled,
    localUserName: process.env.LOCAL_USER_NAME || "Local User",
    localUserEmail: (process.env.LOCAL_USER_EMAIL || "local@meetai.local").toLowerCase(),
    jwtAccessSecret: jwtAccessSecret || "dev-access-secret-auth-disabled",
    jwtRefreshSecret: jwtRefreshSecret || "dev-refresh-secret-auth-disabled",
    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
    bcryptSaltRounds: num(process.env.BCRYPT_SALT_ROUNDS, 12)
  },

  email: {
    host: emailHost,
    port: emailPort,
    secure: bool(process.env.EMAIL_SECURE, emailPort === 465),
    user: first("EMAIL_USER", "SMTP_USER"),
    password: first("EMAIL_PASSWORD", "SMTP_PASS"),
    from: first("EMAIL_FROM", "MAIL_FROM") || "MeetAI <no-reply@meetai.local>",
    /** Default recipient for meeting notifications. Empty = no automatic emails. */
    to: first("EMAIL_TO"),
    notifyOnComplete: bool(process.env.EMAIL_NOTIFY_ON_COMPLETE, true),
    includeTranscript: bool(process.env.EMAIL_INCLUDE_TRANSCRIPT, false)
  }
};

/** Back-compat aliases used by the pre-existing auth stack. */
env.jwtAccessSecret = env.auth.jwtAccessSecret;
env.jwtRefreshSecret = env.auth.jwtRefreshSecret;
env.jwtAccessExpiresIn = env.auth.jwtAccessExpiresIn;
env.jwtRefreshExpiresIn = env.auth.jwtRefreshExpiresIn;
env.bcryptSaltRounds = env.auth.bcryptSaltRounds;
/** Legacy name kept so older imports still resolve. */
env.smtp = env.email;
