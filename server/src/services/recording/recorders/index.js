import { env } from "../../../config/env.js";

/**
 * FFmpeg argument builders per operating system.
 *
 * MeetAI records the screen and a system-audio device with FFmpeg as a separate
 * process. Playwright only drives the browser - it does not capture audio, and
 * MeetAI never pretends otherwise.
 */

function windowsArgs({ outputPath, audioDevice, frameRate, maxSeconds }) {
  const args = ["-y", "-f", "gdigrab", "-framerate", String(frameRate), "-i", "desktop"];
  if (audioDevice) {
    args.push("-f", "dshow", "-i", `audio=${audioDevice}`);
  }
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    ...(audioDevice ? ["-c:a", "aac", "-b:a", "128k"] : []),
    ...(maxSeconds ? ["-t", String(maxSeconds)] : []),
    "-movflags",
    "+faststart",
    outputPath
  );
  return args;
}

function linuxArgs({ outputPath, audioDevice, frameRate, maxSeconds }) {
  const display = process.env.DISPLAY ?? ":0.0";
  const args = ["-y", "-f", "x11grab", "-framerate", String(frameRate), "-i", display];
  if (audioDevice) args.push("-f", "pulse", "-i", audioDevice);
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    ...(audioDevice ? ["-c:a", "aac", "-b:a", "128k"] : []),
    ...(maxSeconds ? ["-t", String(maxSeconds)] : []),
    "-movflags",
    "+faststart",
    outputPath
  );
  return args;
}

function macosArgs({ outputPath, audioDevice, frameRate, maxSeconds }) {
  // avfoundation input is "<screen index>:<audio index>" - the audio index comes
  // from a loopback device such as BlackHole.
  const input = audioDevice ? `1:${audioDevice}` : "1:none";
  return [
    "-y",
    "-f",
    "avfoundation",
    "-framerate",
    String(frameRate),
    "-i",
    input,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    ...(audioDevice ? ["-c:a", "aac", "-b:a", "128k"] : []),
    ...(maxSeconds ? ["-t", String(maxSeconds)] : []),
    "-movflags",
    "+faststart",
    outputPath
  ];
}

const builders = {
  "ffmpeg-windows": windowsArgs,
  "ffmpeg-linux": linuxArgs,
  "ffmpeg-macos": macosArgs
};

export function detectRecorderMode() {
  if (env.recorder.mode && env.recorder.mode !== "auto") return env.recorder.mode;
  if (process.platform === "win32") return "ffmpeg-windows";
  if (process.platform === "darwin") return "ffmpeg-macos";
  return "ffmpeg-linux";
}

export function buildRecorderArgs(mode, options) {
  const builder = builders[mode];
  if (!builder) throw new Error(`Unsupported recorder mode: ${mode}`);
  return builder(options);
}

/** OS-level permission / setup notes surfaced in the UI and the README. */
export const RECORDER_REQUIREMENTS = {
  "ffmpeg-windows":
    "Windows: screen capture uses gdigrab (no extra permission). System audio needs a loopback device - enable Stereo Mix in Sound settings or install VB-Audio Virtual Cable, then set RECORDER_AUDIO_DEVICE to its exact name.",
  "ffmpeg-linux":
    "Linux: screen capture uses x11grab and needs an X11 session (Wayland is not supported). Audio uses a PulseAudio monitor source, e.g. RECORDER_AUDIO_DEVICE=alsa_output.pci-0000_00_1f.3.analog-stereo.monitor",
  "ffmpeg-macos":
    "macOS: grant Screen Recording permission to your terminal in System Settings > Privacy & Security. System audio needs a loopback device such as BlackHole; set RECORDER_AUDIO_DEVICE to its avfoundation index."
};
