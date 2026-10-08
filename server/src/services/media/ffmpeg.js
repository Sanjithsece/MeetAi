import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

export const FFMPEG_UNAVAILABLE =
  "FFmpeg was not found. Install FFmpeg and make sure `ffmpeg` is on PATH (or set FFMPEG_PATH in .env).";

export function runCommand(command, args, { timeoutMs = 0, onStderr, env: extraEnv } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {})
    });
    let stdout = "";
    let stderr = "";
    let timer = null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      onStderr?.(text);
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error.code === "ENOENT" ? new Error(`${command} not found`) : error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(command)} exited with code ${code}: ${stderr.slice(-800)}`));
    });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`${path.basename(command)} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }
  });
}

export async function ffmpegAvailable() {
  try {
    const { stdout, stderr } = await runCommand(env.media.ffmpegPath, ["-version"], { timeoutMs: 10000 });
    const version = (stdout || stderr).split("\n")[0]?.trim();
    return { available: true, version, message: version };
  } catch {
    return { available: false, message: FFMPEG_UNAVAILABLE };
  }
}

/** Duration in seconds, or null when ffprobe is unavailable. */
export async function probeDuration(filePath) {
  try {
    const { stdout } = await runCommand(
      env.media.ffprobePath,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { timeoutMs: 30000 }
    );
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) ? Math.round(seconds) : null;
  } catch (error) {
    logger.debug("ffprobe duration lookup failed", { error: error.message });
    return null;
  }
}

/**
 * meeting.mp4 -> audio.wav (16 kHz mono PCM), the input every local Whisper
 * implementation expects.
 */
export async function extractAudio(videoPath, audioPath) {
  await fs.mkdir(path.dirname(audioPath), { recursive: true });
  await runCommand(
    env.media.ffmpegPath,
    ["-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", audioPath],
    { timeoutMs: 60 * 60 * 1000 }
  );
  return audioPath;
}

/** Lists dshow capture devices on Windows so the user can pick an audio source. */
export function parseDshowAudioDevices(output = "") {
  return [...new Set([...String(output).matchAll(/"([^"]+)"\s*\(audio\)/g)].map((match) => match[1]))];
}

export async function listWindowsCaptureDevices() {
  if (process.platform !== "win32") return { supported: false, devices: [] };
  try {
    // FFmpeg <= 7 exits non-zero for this probe, FFmpeg 8+/9 exits 0 - the
    // device list is on stderr either way, so parse both paths.
    const { stdout, stderr } = await runCommand(
      env.media.ffmpegPath,
      ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
      { timeoutMs: 20000 }
    );
    return { supported: true, devices: parseDshowAudioDevices(`${stderr}\n${stdout}`) };
  } catch (error) {
    return { supported: true, devices: parseDshowAudioDevices(error.message) };
  }
}
