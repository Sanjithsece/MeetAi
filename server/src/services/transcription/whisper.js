import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { runCommand } from "../media/ffmpeg.js";
import { getSettings } from "../settingsService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FASTER_WHISPER_RUNNER = path.join(__dirname, "faster_whisper_runner.py");

export const WHISPER_UNAVAILABLE =
  "Local transcription engine is unavailable. Install one of: `pip install faster-whisper`, `pip install openai-whisper`, or a whisper.cpp build (see README).";

function pythonCommand() {
  if (env.whisper.python) return env.whisper.python;
  return process.platform === "win32" ? "python" : "python3";
}

/**
 * Hugging Face caches model weights with symlinks, which plain Windows accounts
 * are not allowed to create (WinError 1314). Copying instead costs a little disk
 * space and makes the first run work without Developer Mode or admin rights.
 */
const HF_ENV = { HF_HUB_DISABLE_SYMLINKS: "1", HF_HUB_DISABLE_SYMLINKS_WARNING: "1" };

async function canRun(command, args) {
  try {
    await runCommand(command, args, { timeoutMs: 20000 });
    return true;
  } catch {
    return false;
  }
}

async function detectFasterWhisper() {
  return canRun(pythonCommand(), ["-c", "import faster_whisper"]);
}

async function detectOpenaiWhisper() {
  return canRun(pythonCommand(), ["-c", "import whisper"]);
}

async function detectWhisperCpp() {
  if (!env.whisper.cppBinary || !env.whisper.cppModelPath) return false;
  try {
    await fs.access(env.whisper.cppBinary);
    await fs.access(env.whisper.cppModelPath);
    return true;
  } catch {
    return false;
  }
}

/** Resolves the implementation actually usable on this machine right now. */
export async function detectImplementation(preferred) {
  const settings = await getSettings().catch(() => ({ whisperImplementation: env.whisper.implementation }));
  const choice = (preferred ?? settings.whisperImplementation ?? "auto").toLowerCase();

  const checks = {
    "faster-whisper": detectFasterWhisper,
    "openai-whisper": detectOpenaiWhisper,
    "whisper-cpp": detectWhisperCpp
  };

  if (choice !== "auto") {
    const available = await checks[choice]?.();
    return { implementation: choice, available: Boolean(available) };
  }

  for (const name of ["faster-whisper", "openai-whisper", "whisper-cpp"]) {
    if (await checks[name]()) return { implementation: name, available: true };
  }
  return { implementation: null, available: false };
}

export async function whisperHealth() {
  const detected = await detectImplementation();
  return {
    available: detected.available,
    implementation: detected.implementation,
    message: detected.available
      ? `${detected.implementation} is available`
      : WHISPER_UNAVAILABLE
  };
}

async function runFasterWhisper({ audioPath, outputPath, model, language, onProgress }) {
  await runCommand(
    pythonCommand(),
    [
      FASTER_WHISPER_RUNNER,
      "--audio",
      audioPath,
      "--output",
      outputPath,
      "--model",
      model,
      "--language",
      language ?? "",
      "--device",
      env.whisper.device
    ],
    { timeoutMs: 6 * 60 * 60 * 1000, env: HF_ENV, onStderr: (text) => onProgress?.(text.trim()) }
  );
  return outputPath;
}

async function runOpenaiWhisper({ audioPath, outputPath, model, language, onProgress }) {
  const outputDir = path.dirname(outputPath);
  await runCommand(
    pythonCommand(),
    [
      "-m",
      "whisper",
      audioPath,
      "--model",
      model,
      "--output_format",
      "txt",
      "--output_dir",
      outputDir,
      ...(language ? ["--language", language] : []),
      "--fp16",
      "False"
    ],
    { timeoutMs: 6 * 60 * 60 * 1000, env: HF_ENV, onStderr: (text) => onProgress?.(text.trim()) }
  );

  const produced = path.join(outputDir, `${path.basename(audioPath, path.extname(audioPath))}.txt`);
  if (produced !== outputPath) {
    await fs.rename(produced, outputPath);
  }
  return outputPath;
}

async function runWhisperCpp({ audioPath, outputPath, language, onProgress }) {
  const outputBase = outputPath.replace(/\.txt$/i, "");
  await runCommand(
    env.whisper.cppBinary,
    [
      "-m",
      env.whisper.cppModelPath,
      "-f",
      audioPath,
      "-otxt",
      "-of",
      outputBase,
      ...(language ? ["-l", language] : [])
    ],
    { timeoutMs: 6 * 60 * 60 * 1000, onStderr: (text) => onProgress?.(text.trim()) }
  );
  return outputPath;
}

/**
 * audio.wav -> transcript.txt using whichever local Whisper build is installed.
 * No network call and no API key is involved.
 */
export async function transcribeAudio({ audioPath, outputPath, onProgress }) {
  const settings = await getSettings();
  const detected = await detectImplementation(settings.whisperImplementation);
  if (!detected.available) throw new Error(WHISPER_UNAVAILABLE);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const options = {
    audioPath,
    outputPath,
    model: settings.whisperModel,
    language: settings.whisperLanguage,
    onProgress
  };

  logger.info("Transcription started", { engine: detected.implementation, model: settings.whisperModel });

  if (detected.implementation === "faster-whisper") await runFasterWhisper(options);
  else if (detected.implementation === "openai-whisper") await runOpenaiWhisper(options);
  else await runWhisperCpp(options);

  const text = await fs.readFile(outputPath, "utf8");
  if (!text.trim()) {
    throw new Error(
      "No speech was detected in the recording, so the transcript is empty. Check Settings → Recording audio device: a microphone only hears your room - to capture what the meeting plays, enable \"Stereo Mix\" or install VB-Audio Virtual Cable and select it."
    );
  }

  logger.info("Transcription completed", { engine: detected.implementation, characters: text.length });

  return {
    filePath: outputPath,
    text,
    engine: detected.implementation,
    language: settings.whisperLanguage,
    wordCount: text.trim().split(/\s+/).length
  };
}
