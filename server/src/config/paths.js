import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { env } from "./env.js";

const managedDirectories = [
  env.paths.recordings,
  env.paths.transcripts,
  env.paths.meetingNotes,
  env.paths.browserProfile,
  env.paths.logs,
  env.paths.secrets
];

/** Created eagerly at boot so the very first meeting never races on mkdir. */
export function ensureStorageDirectories() {
  for (const directory of managedDirectories) {
    fs.mkdirSync(directory, { recursive: true });
  }
  return managedDirectories;
}

/** Local-only OAuth token store. Never committed, never sent to the frontend. */
export function secretsFile(name) {
  return path.join(env.paths.secrets, name);
}

export async function ensureDir(directory) {
  await fsp.mkdir(directory, { recursive: true });
  return directory;
}

export function recordingDir(meetingId) {
  return path.join(env.paths.recordings, String(meetingId));
}

/**
 * A new file per recording session (meeting-<timestamp>.mp4), so re-joining a
 * meeting can never overwrite - or corrupt while it is being transcribed - an
 * earlier recording. The meeting document points at the latest one.
 */
export function recordingFile(meetingId, startedAt = new Date()) {
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  return path.join(recordingDir(meetingId), `meeting-${stamp}.mp4`);
}

export function audioFile(meetingId) {
  return path.join(recordingDir(meetingId), "audio.wav");
}

export function transcriptDir(meetingId) {
  return path.join(env.paths.transcripts, String(meetingId));
}

export function transcriptFile(meetingId) {
  return path.join(transcriptDir(meetingId), "transcript.txt");
}

export function notesDir(meetingId) {
  return path.join(env.paths.meetingNotes, String(meetingId));
}

export function notesFile(meetingId) {
  return path.join(notesDir(meetingId), "summary.md");
}

/**
 * Guards every path that reaches the file-streaming endpoints: a stored path is
 * only served when it still lives inside one of the managed local directories.
 */
export function isManagedPath(candidate) {
  if (!candidate) return false;
  const resolved = path.resolve(candidate);
  const servable = [env.paths.recordings, env.paths.transcripts, env.paths.meetingNotes];
  return servable.some((directory) => {
    const base = path.resolve(directory);
    return resolved === base || resolved.startsWith(base + path.sep);
  });
}

export async function fileExists(candidate) {
  if (!candidate) return false;
  try {
    const stat = await fsp.stat(candidate);
    return stat.isFile();
  } catch {
    return false;
  }
}
