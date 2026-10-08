import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import { env } from "../../config/env.js";
import { ensureDir, recordingDir, recordingFile } from "../../config/paths.js";
import { logger } from "../../utils/logger.js";
import { ffmpegAvailable, listWindowsCaptureDevices, probeDuration } from "../media/ffmpeg.js";
import { getSettings } from "../settingsService.js";
import { buildRecorderArgs, detectRecorderMode, RECORDER_REQUIREMENTS } from "./recorders/index.js";

/** meetingId -> live recorder handle. */
const active = new Map();

export function isRecording(meetingId) {
  return active.has(String(meetingId));
}

export function activeRecordings() {
  return [...active.keys()];
}

/**
 * On Windows, checks the configured dshow device really exists. A typo or a
 * device copied from another PC otherwise only fails inside FFmpeg with an
 * obscure "Could not find audio only device" message.
 */
export async function checkAudioDevice(audioDevice, mode = detectRecorderMode()) {
  if (!audioDevice || mode !== "ffmpeg-windows" || process.platform !== "win32") return { checked: false, found: true, devices: [] };
  const { devices } = await listWindowsCaptureDevices().catch(() => ({ devices: [] }));
  if (!devices.length) return { checked: false, found: true, devices };
  return { checked: true, found: devices.includes(audioDevice), devices };
}

export async function recorderHealth() {
  const mode = detectRecorderMode();
  const ffmpeg = await ffmpegAvailable();
  const settings = await getSettings().catch(() => ({ recorderAudioDevice: env.recorder.audioDevice }));
  const audioDevice = settings.recorderAudioDevice;
  const device = ffmpeg.available ? await checkAudioDevice(audioDevice, mode) : { checked: false, found: true, devices: [] };

  if (audioDevice && !device.found) {
    return {
      available: false,
      mode,
      ffmpeg,
      audioDevice,
      audioReady: false,
      availableDevices: device.devices,
      allowVideoOnly: env.recorder.allowVideoOnly,
      requirements: RECORDER_REQUIREMENTS[mode] ?? "",
      message: `Audio device "${audioDevice}" was not found. Available: ${device.devices.map((name) => `"${name}"`).join(", ") || "none"}`
    };
  }

  return {
    available: ffmpeg.available && mode !== "disabled",
    mode,
    ffmpeg,
    audioDevice: audioDevice || null,
    audioReady: Boolean(audioDevice),
    availableDevices: device.devices,
    allowVideoOnly: env.recorder.allowVideoOnly,
    requirements: RECORDER_REQUIREMENTS[mode] ?? "",
    message: !ffmpeg.available
      ? ffmpeg.message
      : mode === "disabled"
        ? "Recording is disabled (RECORDER=disabled)"
        : audioDevice
          ? `Ready: ${mode} capturing audio from "${audioDevice}"`
          : `Screen capture is ready but no system-audio device is configured, so recordings would be silent. ${RECORDER_REQUIREMENTS[mode] ?? ""}`
  };
}

/**
 * Starts a real screen + system-audio capture into
 * recordings/<meeting id>/meeting.mp4 .
 *
 * Fails loudly when FFmpeg is missing or no audio device is configured - a
 * silent recording would produce an empty transcript, so it is never started
 * silently (set RECORDER_ALLOW_VIDEO_ONLY=true to opt in anyway).
 */
export async function startRecording(meetingId) {
  const key = String(meetingId);
  if (active.has(key)) return active.get(key).info;

  const mode = detectRecorderMode();
  if (mode === "disabled") throw new Error("Recording is disabled (RECORDER=disabled)");

  const health = await recorderHealth();
  if (!health.ffmpeg.available) throw new Error(health.ffmpeg.message);
  if (health.audioDevice && health.availableDevices?.length && !health.availableDevices.includes(health.audioDevice)) {
    throw new Error(`${health.message}. Pick one in Settings or set RECORDER_AUDIO_DEVICE in .env.`);
  }
  if (!health.audioReady && !env.recorder.allowVideoOnly) {
    throw new Error(
      `No system-audio capture device is configured, so the recording would have no sound. ${RECORDER_REQUIREMENTS[mode] ?? ""} Set it from Settings or in .env (RECORDER_AUDIO_DEVICE), or set RECORDER_ALLOW_VIDEO_ONLY=true to record video only.`
    );
  }

  await ensureDir(recordingDir(key));
  const outputPath = recordingFile(key);
  const args = buildRecorderArgs(mode, {
    outputPath,
    audioDevice: health.audioDevice,
    frameRate: env.recorder.frameRate,
    maxSeconds: env.recorder.maxMinutes > 0 ? env.recorder.maxMinutes * 60 : 0
  });

  const child = spawn(env.media.ffmpegPath, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });

  let stderrTail = "";
  child.stderr.on("data", (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-4000);
  });

  const exited = new Promise((resolve) => {
    child.on("close", (code) => {
      active.delete(key);
      resolve(code);
    });
    child.on("error", (error) => {
      active.delete(key);
      logger.error("Recorder process error", { meetingId: key, error: error.message });
      resolve(-1);
    });
  });

  const info = {
    meetingId: key,
    filePath: outputPath,
    mode,
    audioDevice: health.audioDevice ?? null,
    startedAt: new Date()
  };
  active.set(key, { child, info, exited, stderr: () => stderrTail });

  logger.info("Recording started", { meetingId: key, mode, filePath: outputPath, audio: Boolean(health.audioDevice) });
  return info;
}

/** Graceful stop: FFmpeg needs a `q` on stdin to finalise the MP4 container. */
export async function stopRecording(meetingId) {
  const key = String(meetingId);
  const handle = active.get(key);
  if (!handle) return null;

  try {
    handle.child.stdin.write("q");
    handle.child.stdin.end();
  } catch {
    handle.child.kill("SIGINT");
  }

  const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), 15000));
  const outcome = await Promise.race([handle.exited, timeout]);
  if (outcome === "timeout") {
    logger.warn("Recorder did not exit in time, terminating", { meetingId: key });
    handle.child.kill("SIGKILL");
    await handle.exited;
  }

  const filePath = handle.info.filePath;
  let sizeBytes = 0;
  try {
    sizeBytes = (await fsp.stat(filePath)).size;
  } catch {
    throw new Error(`Recording file was not written: ${filePath}. FFmpeg output: ${handle.stderr().slice(-500)}`);
  }

  if (sizeBytes < 1024) {
    throw new Error(`Recording file is empty (${sizeBytes} bytes). FFmpeg output: ${handle.stderr().slice(-500)}`);
  }

  const durationSeconds = await probeDuration(filePath);
  logger.info("Recording saved", { meetingId: key, sizeBytes, durationSeconds, filePath });

  return {
    filePath,
    format: "mp4",
    sizeBytes,
    durationSeconds,
    recordedAt: handle.info.startedAt,
    recorder: handle.info.mode
  };
}

/** Called on shutdown so an in-flight MP4 is still finalised. */
export async function stopAllRecordings() {
  const results = [];
  for (const key of [...active.keys()]) {
    results.push(await stopRecording(key).catch((error) => ({ meetingId: key, error: error.message })));
  }
  return results;
}
