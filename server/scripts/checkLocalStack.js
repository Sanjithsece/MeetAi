/**
 * Prints the state of every local dependency MeetAI needs, without starting the
 * API. Useful the first time you set the project up:
 *
 *   npm run check:local
 */
import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { ensureStorageDirectories } from "../src/config/paths.js";
import { aiHealth } from "../src/services/ai/index.js";
import { gmailStatus } from "../src/services/gmail/oauthClient.js";
import { emailStatus } from "../src/services/mailService.js";
import { ragStatus } from "../src/services/rag/ragService.js";
import { ffmpegAvailable } from "../src/services/media/ffmpeg.js";
import { notionStatus } from "../src/services/notion/notionService.js";
import { recorderHealth } from "../src/services/recording/recorder.js";
import { whisperHealth } from "../src/services/transcription/whisper.js";

const tick = (ok) => (ok ? "OK  " : "--  ");

function line(name, ok, detail) {
  console.log(`${tick(ok)} ${name.padEnd(12)} ${detail}`);
}

ensureStorageDirectories();
console.log("\nMeetAI local stack\n------------------");

let mongoOk = false;
let mongoDetail = "";
try {
  await mongoose.connect(env.mongodbUri, { serverSelectionTimeoutMS: 3000 });
  mongoOk = true;
  mongoDetail = env.mongodbUri;
} catch (error) {
  mongoDetail = `${error.message} - start a local mongod`;
}
line("MongoDB", mongoOk, mongoDetail);

const ai = await aiHealth();
line("Ollama", ai.ollama.available && ai.ollama.modelReady, ai.ollama.message);
line("Embeddings", Boolean(ai.ollama.embeddingReady), ai.ollama.embeddingReady ? `${ai.ollama.embeddingModel} ready` : `run: ollama pull ${env.ai.ollamaEmbeddingModel}`);
line("AI mode", true, `${ai.provider} (cloud fallback ${env.ai.cloudFallback ? "on" : "off"})`);
line("Gemini", ai.gemini.configured, ai.gemini.message);

const whisper = await whisperHealth();
line("Whisper", whisper.available, whisper.message);

const ffmpeg = await ffmpegAvailable();
line("FFmpeg", ffmpeg.available, ffmpeg.message);

const recorder = await recorderHealth();
line("Recorder", recorder.available && recorder.audioReady, recorder.message);
if (recorder.availableDevices?.length) console.log(`     audio devices: ${recorder.availableDevices.map((name) => `"${name}"`).join(", ")}`);

const rag = mongoOk ? await ragStatus() : { available: false, message: "needs MongoDB" };
line("RAG", rag.available, `${rag.message}${rag.chunks != null ? ` - ${rag.chunks} chunks` : ""}`);

const email = await emailStatus();
line("Email", Boolean(email.configured && email.connected !== false), email.message);

const gmail = await gmailStatus();
line("Gmail", gmail.connected, gmail.message);

const notion = await notionStatus();
line("Notion", notion.connected, notion.message);

console.log("\nStorage");
console.log(`     recordings   ${env.paths.recordings}`);
console.log(`     transcripts  ${env.paths.transcripts}`);
console.log(`     notes        ${env.paths.meetingNotes}`);
console.log(`     profile      ${env.paths.browserProfile}\n`);

await mongoose.disconnect().catch(() => undefined);
process.exit(0);
