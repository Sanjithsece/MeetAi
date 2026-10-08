import fsp from "node:fs/promises";
import { env } from "../../config/env.js";
import { audioFile, ensureDir, fileExists, notesDir, notesFile, transcriptDir, transcriptFile } from "../../config/paths.js";
import { Meeting } from "../../models/Meeting.js";
import { Task } from "../../models/Task.js";
import { logger } from "../../utils/logger.js";
import { recordActivity } from "../activityService.js";
import { analyzeTranscript } from "../ai/index.js";
import * as meetBot from "../automation/meetBot.js";
import { sendMeetingSummary } from "../mailService.js";
import { extractAudio } from "../media/ffmpeg.js";
import { createMeetingPage, isNotionConfigured } from "../notion/notionService.js";
import { indexMeeting } from "../rag/ragService.js";
import * as recorder from "../recording/recorder.js";
import { getSettings } from "../settingsService.js";
import { transcribeAudio } from "../transcription/whisper.js";
import { activeJobFor, enqueue } from "./jobQueue.js";

/**
 * MeetingAutomationService - owns the whole meeting lifecycle:
 * join -> record -> stop -> transcribe -> analyse -> tasks -> RAG -> Notion -> email.
 *
 * Every step is independently retryable and no later failure is allowed to
 * destroy an earlier artefact: a failed analysis never deletes the recording or
 * the transcript, and RAG / Notion / email failures never fail the meeting.
 */

const monitors = new Map();
const STAGE_RETRY_DELAY_MS = Number(process.env.PIPELINE_RETRY_DELAY_MS ?? 5000);

async function loadMeeting(meetingId) {
  const meeting = await Meeting.findById(meetingId);
  if (!meeting) throw new Error("Meeting not found");
  return meeting;
}

async function setStatus(meeting, status, detail) {
  meeting.pushStatus(status, detail);
  await meeting.save();
  logger.info(`Meeting status: ${status}`, { meetingId: String(meeting._id), detail });
  return meeting;
}

/** Writes an activity row and persists the stage state on the meeting. */
async function track(meeting, stage, status, message, meta) {
  await recordActivity({ meeting, stage, status, message, meta });
  await meeting.save().catch((error) => logger.warn("Stage state save failed", { error: error.message }));
}

/** Errors that are worth one more attempt (network/AI hiccups, not missing files). */
function isTransient(error) {
  return /timed out|timeout|unavailable|ECONNRESET|ECONNREFUSED|socket hang up|5\d\d|AI_PROVIDER_UNAVAILABLE/i.test(
    `${error.code ?? ""} ${error.message}`
  );
}

async function withStageRetry(meetingId, stage, fn, retries = 1) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= retries || !isTransient(error)) throw error;
      const meeting = await loadMeeting(meetingId);
      await track(meeting, stage, "RETRYING", `Attempt ${attempt + 1} failed (${error.message.slice(0, 200)}), retrying`);
      await new Promise((resolve) => setTimeout(resolve, STAGE_RETRY_DELAY_MS));
    }
  }
}

// ---------------------------------------------------------------------------
// Joining: background loop with retries and waiting-room support
// ---------------------------------------------------------------------------

/** meetingId -> { cancelled } for joins in progress. */
const joining = new Map();

const joinConfig = () => ({
  attempts: Math.max(1, Number(process.env.MEETING_JOIN_RETRIES ?? 10)),
  delayMs: Math.max(1, Number(process.env.MEETING_JOIN_RETRY_DELAY_SECONDS ?? 30)) * 1000,
  lobbyMs: Math.max(1, Number(process.env.MEETING_LOBBY_MAX_MINUTES ?? 15)) * 60_000
});

export function isJoining(meetingId) {
  return joining.has(String(meetingId));
}

const wait = (ms, handle) =>
  new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (handle.cancelled || Date.now() - started >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, 500);
  });

/**
 * Joins the meeting in the background and returns immediately.
 *
 * Each attempt opens the meeting with the persistent profile. If Meet puts the
 * bot in the waiting room ("Ask to join" / meeting not open yet), it waits for
 * the host to admit it; recording starts only once it is actually in the call.
 * Failed or refused attempts are retried MEETING_JOIN_RETRIES times, every
 * MEETING_JOIN_RETRY_DELAY_SECONDS, and every attempt is on the Activity timeline.
 */
export async function startMeeting(meetingId, { record = true } = {}) {
  const meeting = await loadMeeting(meetingId);
  if (!meeting.meetingUrl) throw new Error("This meeting has no meeting URL");
  const key = String(meeting._id);
  if (joining.has(key)) return { joining: true, alreadyRunning: true };
  if (meetBot.isJoined(key)) return { joined: true, recording: recorder.isRecording(key) };
  // Never start a second capture while the previous one is being transcribed/analysed.
  if (["TRANSCRIBING", "ANALYZING"].includes(meeting.status) || (await activeJobFor(meeting._id))) {
    const error = new Error("This meeting's recording is still being processed. Wait for it to finish before joining again.");
    error.statusCode = 409;
    error.code = "MEETING_BUSY";
    throw error;
  }

  const handle = { cancelled: false };
  joining.set(key, handle);
  await setStatus(meeting, "JOINING", meeting.meetingUrl);
  await track(meeting, "join", "RUNNING", "Launching browser and joining the meeting");

  joinWithRetries(key, { record, handle })
    .catch((error) => logger.error("Join loop crashed", { meetingId: key, error: error.message }))
    .finally(() => joining.delete(key));

  return { joining: true };
}

async function joinWithRetries(key, { record, handle }) {
  const { attempts, delayMs, lobbyMs } = joinConfig();
  const settings = await getSettings();
  let lastError = "";

  for (let attempt = 1; attempt <= attempts && !handle.cancelled; attempt += 1) {
    const meeting = await loadMeeting(key);
    try {
      const session = await meetBot.joinMeeting({
        meetingId: key,
        meetingUrl: meeting.meetingUrl,
        displayName: settings.meetingDisplayName || env.meeting.displayName
      });

      if (session.state === "waiting-room" || session.state === "unknown") {
        await track(meeting, "join", "RUNNING", `Waiting for the host to let you in (up to ${Math.round(lobbyMs / 60000)} min)`);
        const admitted = await meetBot.waitForAdmission(key, { timeoutMs: lobbyMs, shouldStop: () => handle.cancelled });
        if (admitted !== "in-call") {
          await meetBot.leaveMeeting(key);
          if (handle.cancelled) break;
          throw new meetBot.JoinError(
            admitted === "blocked" ? "The host did not let MeetAI in (request refused)" : `Not admitted within ${Math.round(lobbyMs / 60000)} minutes`,
            { retryable: true }
          );
        }
      }

      if (handle.cancelled) {
        await meetBot.leaveMeeting(key);
        break;
      }
      const joined = await loadMeeting(key);
      joined.automation.joinedAt = session.joinedAt;
      joined.automation.lastError = undefined;
      await track(joined, "join", "COMPLETED", `Joined the meeting on attempt ${attempt} (${session.browser ?? "browser"})`);
      await startRecordingAfterJoin(joined, { record });
      return;
    } catch (error) {
      // Playwright errors carry ANSI colour codes and a multi-line call log.
      lastError = meetBot.firstLine(error.message);
      const retryable = error.retryable !== false && attempt < attempts && !handle.cancelled;
      const latest = await loadMeeting(key);
      latest.automation.lastError = lastError;
      if (!retryable) break;
      await track(latest, "join", "RETRYING", `Attempt ${attempt}/${attempts} failed: ${lastError.slice(0, 220)} - retrying in ${Math.round(delayMs / 1000)} s`);
      await wait(delayMs, handle);
    }
  }

  const meeting = await loadMeeting(key);
  if (handle.cancelled) {
    await track(meeting, "join", "SKIPPED", "Join cancelled");
    await setStatus(meeting, "UPCOMING", "Join cancelled by user");
    return;
  }
  await track(meeting, "join", "FAILED", `Could not join: ${lastError.slice(0, 400)}`);
  await setStatus(meeting, "FAILED", `Join failed: ${lastError}`);
}

/** Cancels a join that is still retrying / waiting in the lobby. */
export async function cancelJoin(meetingId) {
  const handle = joining.get(String(meetingId));
  if (!handle) return false;
  handle.cancelled = true;
  await meetBot.leaveMeeting(String(meetingId)).catch(() => undefined);
  return true;
}

async function startRecordingAfterJoin(meeting, { record }) {
  if (!record || meeting.automation.autoRecord === false) {
    await track(meeting, "recording", "SKIPPED", "Joined without recording");
    await setStatus(meeting, "RECORDING", "Joined without recording");
    watchMeeting(meeting._id);
    return { joined: true, recording: false };
  }

  try {
    await recorder.startRecording(String(meeting._id));
    await track(meeting, "recording", "RUNNING", "Recording started");
    await setStatus(meeting, "RECORDING", "Recording started");
  } catch (error) {
    meeting.recording.error = error.message;
    meeting.automation.lastError = error.message;
    await track(meeting, "recording", "FAILED", error.message);
    await setStatus(meeting, "RECORDING_FAILED", error.message);
    logger.error("Recording failed to start", { meetingId: String(meeting._id), error: error.message });
    // The browser stays in the call; the user can still attend it manually.
    watchMeeting(meeting._id);
    return { joined: true, recording: false, error: error.message };
  }

  watchMeeting(meeting._id);
  return { joined: true, recording: true };
}

/** Stops the recording, leaves the call and optionally queues processing. */
export async function stopMeeting(meetingId, { process: shouldProcess } = {}) {
  // Still retrying / waiting for the host: cancel the join instead.
  if (await cancelJoin(meetingId)) return { cancelled: true, recording: null, job: null };

  const meeting = await loadMeeting(meetingId);
  const settings = await getSettings();
  clearWatch(meetingId);

  let recordingResult = null;
  try {
    recordingResult = await recorder.stopRecording(String(meeting._id));
  } catch (error) {
    meeting.recording.error = error.message;
    await track(meeting, "recording", "FAILED", error.message);
    await setStatus(meeting, "RECORDING_FAILED", error.message);
    await meetBot.leaveMeeting(String(meeting._id));
    throw error;
  }

  await meetBot.leaveMeeting(String(meeting._id));
  meeting.automation.leftAt = new Date();

  if (recordingResult) {
    meeting.recording = { ...recordingResult, error: undefined };
    await track(meeting, "recording", "COMPLETED", `Recording saved (${Math.round((recordingResult.sizeBytes ?? 0) / 1024)} KB)`);
    await setStatus(meeting, "RECORDING_COMPLETED", recordingResult.filePath);
  } else if (meeting.status !== "RECORDING_FAILED") {
    await setStatus(meeting, "RECORDING_COMPLETED", "No recording was made");
  }

  const wantsProcessing = shouldProcess ?? (settings.autoProcessAfterRecording && meeting.automation.autoProcess !== false);
  if (wantsProcessing && recordingResult) {
    return { recording: recordingResult, job: await queueProcessing(meeting._id) };
  }
  return { recording: recordingResult, job: null };
}

/** Polls Google Meet so a call that ends on its own also stops the recorder. */
function watchMeeting(meetingId) {
  const key = String(meetingId);
  if (monitors.has(key)) return;

  const timer = setInterval(async () => {
    try {
      if (await meetBot.hasMeetingEnded(key)) {
        clearWatch(key);
        logger.info("Meeting ended, finalising", { meetingId: key });
        await stopMeeting(key).catch((error) => logger.error("Auto-stop failed", { meetingId: key, error: error.message }));
      }
    } catch (error) {
      logger.debug("Meeting watch tick failed", { meetingId: key, error: error.message });
    }
  }, 20000);

  monitors.set(key, timer);
}

function clearWatch(meetingId) {
  const key = String(meetingId);
  const timer = monitors.get(key);
  if (timer) {
    clearInterval(timer);
    monitors.delete(key);
  }
}

export function watchedMeetings() {
  return [...monitors.keys()];
}

// ---------------------------------------------------------------------------
// Processing steps
// ---------------------------------------------------------------------------

/** Limits progress writes (Whisper prints a line per segment) to one every few seconds. */
function throttle(fn, intervalMs = 3000) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last < intervalMs) return undefined;
    last = now;
    return fn(...args);
  };
}

export async function runTranscription(meetingId, report = () => {}) {
  const meeting = await loadMeeting(meetingId);
  const recordingPath = meeting.recording?.filePath;
  if (!(await fileExists(recordingPath))) {
    await track(meeting, "transcription", "FAILED", "No local recording is available for this meeting");
    throw new Error("No local recording is available for this meeting");
  }

  await setStatus(meeting, "TRANSCRIBING");
  meeting.transcript.status = "PROCESSING";
  meeting.transcript.error = undefined;
  await track(meeting, "transcription", "RUNNING", "Extracting audio and transcribing locally");

  try {
    await report("extracting audio", 10);
    const wavPath = audioFile(meeting._id);
    await extractAudio(recordingPath, wavPath);

    await report("transcribing", 25);
    await ensureDir(transcriptDir(meeting._id));
    const result = await transcribeAudio({
      audioPath: wavPath,
      outputPath: transcriptFile(meeting._id),
      onProgress: throttle(() => report("transcribing"))
    });

    meeting.transcript = {
      filePath: result.filePath,
      status: "COMPLETED",
      engine: result.engine,
      language: result.language,
      wordCount: result.wordCount,
      generatedAt: new Date()
    };
    await track(meeting, "transcription", "COMPLETED", `Transcript saved (${result.wordCount} words, ${result.engine})`);

    // The WAV is a large intermediate - the MP4 and the transcript are kept.
    await fsp.rm(wavPath, { force: true });

    return result.text;
  } catch (error) {
    meeting.transcript.status = "FAILED";
    meeting.transcript.error = error.message;
    await track(meeting, "transcription", "FAILED", error.message);
    await setStatus(meeting, "FAILED", `Transcription failed: ${error.message}`);
    throw error;
  }
}

async function readTranscript(meeting) {
  if (meeting.transcript?.filePath && (await fileExists(meeting.transcript.filePath))) {
    return fsp.readFile(meeting.transcript.filePath, "utf8");
  }
  return null;
}

const bulletList = (items) => (items?.length ? items.map((item) => `- ${item}`) : ["- none"]);

function renderNotes(meeting, analysis) {
  const lines = [
    `# ${analysis.title || meeting.title}`,
    "",
    `- Date: ${meeting.startTime ? new Date(meeting.startTime).toLocaleString() : "unknown"}`,
    `- Participants: ${(meeting.participants ?? []).map((p) => p.name || p.email).filter(Boolean).join(", ") || "not recorded"}`,
    `- Provider: ${analysis.providerLabel ?? analysis.provider} (${analysis.model})${analysis.chunked ? " - long transcript analysed in parts" : ""}`,
    "",
    "## Short summary",
    analysis.shortSummary || "-",
    "",
    "## Summary",
    analysis.summary || "No summary.",
    "",
    "## Key points",
    ...bulletList(analysis.keyPoints),
    "",
    "## Important topics",
    ...bulletList(analysis.importantTopics),
    "",
    "## Decisions",
    ...bulletList(analysis.decisions),
    "",
    "## Action items",
    ...(analysis.actionItems.length
      ? analysis.actionItems.map((item) => `- ${item.task}${item.person ? ` (${item.person})` : ""}${item.deadline ? ` - due ${item.deadline}` : ""} [${item.priority}]`)
      : ["- none"]),
    "",
    "## Deadlines",
    ...(analysis.deadlines.length ? analysis.deadlines.map((item) => `- ${[item.label, item.date, item.person].filter(Boolean).join(" - ")}`) : ["- none"]),
    "",
    "## Open questions",
    ...bulletList(analysis.questions),
    "",
    "## Recommended follow-ups",
    ...bulletList(analysis.followUps),
    "",
    `Sentiment: ${analysis.sentiment} | Priority: ${analysis.priority}${analysis.meetingStatus ? ` | Status: ${analysis.meetingStatus}` : ""}`,
    ""
  ];
  return lines.join("\n");
}

/** Turns AI action items into Task documents, skipping ones already created. */
async function createTasksFromAnalysis(meeting, analysis) {
  const settings = await getSettings();
  if (!settings.createTasksFromActionItems) return 0;

  let created = 0;
  for (const item of analysis.actionItems) {
    // Case/space/punctuation-insensitive so a re-run that rephrases
    // "create the schema" as "Create the schema." does not duplicate the task.
    const normalizedTask = item.task.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const key = `${meeting._id}:${normalizedTask}`.slice(0, 300);
    const exists = await Task.findOne({ sourceActionItem: key });
    if (exists) continue;

    const deadline = item.deadline ? new Date(item.deadline) : null;
    await Task.create({
      owner: meeting.owner,
      meeting: meeting._id,
      title: item.task.slice(0, 240),
      description: item.deadline ? `Stated deadline: ${item.deadline}` : "",
      assigneeName: item.person || "",
      deadline: deadline && !Number.isNaN(deadline.valueOf()) ? deadline : null,
      priority: item.priority,
      status: "PENDING",
      aiGenerated: true,
      sourceActionItem: key
    });
    created += 1;
  }
  return created;
}

export async function runAnalysis(meetingId, report = () => {}) {
  const meeting = await loadMeeting(meetingId);
  const transcript = await readTranscript(meeting);
  if (!transcript?.trim()) {
    await track(meeting, "analysis", "FAILED", "No transcript is available for this meeting");
    throw new Error("No transcript is available for this meeting");
  }

  await setStatus(meeting, "ANALYZING");
  meeting.aiAnalysis.status = "PROCESSING";
  meeting.aiAnalysis.error = undefined;
  await track(meeting, "analysis", "RUNNING", "AI analysis started");

  try {
    await report("analysing transcript", 60);
    const analysis = await withStageRetry(meeting._id, "analysis", () => analyzeTranscript({ meeting, transcript }));

    await ensureDir(notesDir(meeting._id));
    const notesPath = notesFile(meeting._id);
    await fsp.writeFile(notesPath, renderNotes(meeting, analysis), "utf8");

    const fresh = await loadMeeting(meeting._id);
    fresh.aiAnalysis = {
      status: "COMPLETED",
      provider: analysis.providerLabel ?? analysis.provider,
      model: analysis.model,
      title: analysis.title,
      shortSummary: analysis.shortSummary,
      summary: analysis.summary,
      keyPoints: analysis.keyPoints,
      questions: analysis.questions,
      followUps: analysis.followUps,
      meetingStatus: analysis.meetingStatus,
      importantTopics: analysis.importantTopics,
      decisions: analysis.decisions,
      actionItems: analysis.actionItems,
      deadlines: analysis.deadlines,
      peopleResponsible: analysis.peopleResponsible,
      sentiment: analysis.sentiment,
      priority: analysis.priority,
      notesPath,
      chunked: analysis.chunked,
      attempts: analysis.attempts,
      generatedAt: new Date()
    };
    await fresh.save();

    const tasksCreated = await createTasksFromAnalysis(fresh, analysis);
    const fallbackUsed = analysis.attempts.some((attempt) => attempt.outcome !== "success");
    await track(
      fresh,
      "analysis",
      "COMPLETED",
      `Summary, ${analysis.decisions.length} decision(s) and ${analysis.actionItems.length} action item(s) by ${analysis.providerLabel ?? analysis.provider}${fallbackUsed ? " (after provider fallback)" : ""}`,
      { tasksCreated }
    );

    // Safe for any caller: running the analysis on its own also finishes the
    // meeting, and the pipeline's closing setStatus is idempotent.
    await setStatus(fresh, "COMPLETED", "AI analysis completed");

    return analysis;
  } catch (error) {
    const failed = await loadMeeting(meeting._id);
    failed.aiAnalysis.status = "FAILED";
    failed.aiAnalysis.error = error.message;
    await track(failed, "analysis", "FAILED", error.message);
    // The recording and transcript are untouched, so this is retryable.
    await setStatus(failed, "FAILED", `AI analysis failed: ${error.message}`);
    throw error;
  }
}

/** RAG ingestion. A failure is recorded but never fails the meeting. */
export async function runRagIngest(meetingId) {
  const meeting = await loadMeeting(meetingId);
  if (!env.rag.enabled) {
    meeting.rag = { status: "SKIPPED", error: "RAG_ENABLED=false" };
    await track(meeting, "rag", "SKIPPED", "RAG is disabled");
    return { skipped: true };
  }
  await track(meeting, "rag", "RUNNING", "Indexing meeting for search");
  try {
    const result = await withStageRetry(meeting._id, "rag", () => indexMeeting(meeting));
    const fresh = await loadMeeting(meeting._id);
    if (result.skipped) {
      fresh.rag = { status: "SKIPPED", error: result.reason };
      await track(fresh, "rag", "SKIPPED", result.reason);
      return result;
    }
    fresh.rag = { status: "COMPLETED", chunks: result.chunks, store: result.store, indexedAt: new Date() };
    await track(fresh, "rag", "COMPLETED", `Indexed ${result.chunks} chunk(s) in ${result.store}`);
    return result;
  } catch (error) {
    const fresh = await loadMeeting(meeting._id);
    fresh.rag = { status: "FAILED", error: error.message };
    await track(fresh, "rag", "FAILED", error.message);
    logger.warn("RAG ingestion failed", { meetingId: String(meeting._id), error: error.message });
    return { skipped: true, reason: error.message };
  }
}

/** Optional. A Notion failure is recorded but never fails the meeting. */
export async function runNotionSync(meetingId) {
  const meeting = await loadMeeting(meetingId);
  if (!isNotionConfigured()) {
    await track(meeting, "notion", "SKIPPED", "Notion is not configured");
    return { skipped: true, reason: "Notion is not configured" };
  }
  if (meeting.aiAnalysis?.status !== "COMPLETED") {
    await track(meeting, "notion", "SKIPPED", "AI analysis has not completed yet");
    return { skipped: true, reason: "AI analysis has not completed yet" };
  }

  try {
    const page = await createMeetingPage(meeting);
    if (page.skipped) return page;
    meeting.notion = { pageId: page.pageId, pageUrl: page.pageUrl, createdAt: page.createdAt, error: undefined };
    await track(meeting, "notion", "COMPLETED", "Notion page created");
    return page;
  } catch (error) {
    meeting.notion.error = error.message;
    await track(meeting, "notion", "FAILED", error.message);
    logger.warn("Notion page creation failed", { meetingId: String(meeting._id), error: error.message });
    return { skipped: true, reason: error.message };
  }
}

/** Optional summary email. Skipped (not failed) when SMTP or a recipient is missing. */
export async function runEmail(meetingId, { to } = {}) {
  const meeting = await loadMeeting(meetingId);
  const recipient = to || env.email.to;
  if (meeting.aiAnalysis?.status !== "COMPLETED") {
    await track(meeting, "email", "SKIPPED", "AI analysis has not completed yet");
    return { status: "SKIPPED" };
  }
  if (!to && (!env.email.notifyOnComplete || !recipient)) {
    meeting.email = { status: "SKIPPED", error: "No EMAIL_TO recipient configured" };
    await track(meeting, "email", "SKIPPED", "No EMAIL_TO recipient configured");
    return { status: "SKIPPED" };
  }

  const transcriptText = env.email.includeTranscript ? await readTranscript(meeting) : undefined;
  const result = await sendMeetingSummary({ meeting, to: recipient, transcriptText });
  meeting.email = { status: result.status, to: recipient, sentAt: result.status === "SENT" ? new Date() : undefined, error: result.error };
  await track(meeting, "email", result.status === "SENT" ? "COMPLETED" : result.status, result.status === "SENT" ? "Summary email sent" : `Email ${result.status.toLowerCase()}: ${result.error ?? ""}`);
  return result;
}

/**
 * Queues the background pipeline. Steps default to everything that still needs
 * doing; `force` re-runs completed steps.
 */
export async function queueProcessing(meetingId, { steps, force = false } = {}) {
  const meeting = await loadMeeting(meetingId);

  const wanted = new Set(
    steps ?? [
      ...(force || meeting.transcript?.status !== "COMPLETED" ? ["transcribe"] : []),
      ...(force || meeting.aiAnalysis?.status !== "COMPLETED" ? ["analyze"] : []),
      "rag",
      "notion",
      "email"
    ]
  );

  return enqueue({
    meetingId: meeting._id,
    type: "FULL_PIPELINE",
    async run(report) {
      if (wanted.has("transcribe")) await runTranscription(meeting._id, report);
      // A failed analysis must not stop the transcript from becoming searchable:
      // keep going through RAG (Notion/email skip themselves), then report it.
      let analysisError = null;
      if (wanted.has("analyze")) {
        try {
          await runAnalysis(meeting._id, report);
        } catch (error) {
          analysisError = error;
        }
      }
      if (wanted.has("rag")) {
        await report("indexing for search", 85);
        await runRagIngest(meeting._id);
      }
      if (wanted.has("notion")) {
        await report("syncing to notion", 90);
        await runNotionSync(meeting._id);
      }
      if (wanted.has("email")) {
        await report("sending email", 95);
        await runEmail(meeting._id);
      }
      if (analysisError) throw analysisError;
      const finished = await loadMeeting(meeting._id);
      const analysisDone = finished.aiAnalysis?.status === "COMPLETED";
      await setStatus(finished, analysisDone ? "COMPLETED" : "RECORDING_COMPLETED", "Processing finished");
    }
  });
}

/** Graceful shutdown: finalise MP4s and close browser sessions. */
export async function shutdownPipeline() {
  for (const key of watchedMeetings()) clearWatch(key);
  await recorder.stopAllRecordings().catch(() => undefined);
  await meetBot.leaveAllMeetings().catch(() => undefined);
}
