import { ProcessingJob } from "../../models/ProcessingJob.js";
import { logger } from "../../utils/logger.js";

/**
 * Tiny in-process background queue.
 *
 * Transcription and local LLM analysis take minutes, so HTTP handlers only
 * enqueue work and return immediately; the frontend polls the job record. Jobs
 * run one at a time on purpose - Whisper and Ollama both want the whole CPU.
 */

const queue = [];
let running = false;

async function drain() {
  if (running) return;
  running = true;

  while (queue.length) {
    const item = queue.shift();
    const job = await ProcessingJob.findByIdAndUpdate(
      item.jobId,
      { status: "RUNNING", startedAt: new Date(), step: "starting", progress: 1 },
      { new: true }
    );
    if (!job) continue;

    const report = async (step, progress) => {
      await ProcessingJob.findByIdAndUpdate(item.jobId, {
        step,
        ...(progress === undefined ? {} : { progress })
      });
    };

    try {
      await item.run(report);
      await ProcessingJob.findByIdAndUpdate(item.jobId, {
        status: "COMPLETED",
        step: "done",
        progress: 100,
        finishedAt: new Date()
      });
    } catch (error) {
      logger.error("Processing failed", { jobId: String(item.jobId), type: item.type, error: error.message });
      await ProcessingJob.findByIdAndUpdate(item.jobId, {
        status: "FAILED",
        error: error.message,
        finishedAt: new Date()
      });
      item.onError?.(error);
    }
  }

  running = false;
}

/** Enqueues work and returns the durable job document. */
export async function enqueue({ meetingId, type, run, onError }) {
  const job = await ProcessingJob.create({ meeting: meetingId, type, status: "QUEUED" });
  queue.push({ jobId: job._id, meetingId, type, run, onError });
  setImmediate(drain);
  return job;
}

export function queueDepth() {
  return queue.length + (running ? 1 : 0);
}

export async function activeJobFor(meetingId) {
  return ProcessingJob.findOne({ meeting: meetingId, status: { $in: ["QUEUED", "RUNNING"] } }).sort({ createdAt: -1 });
}

export async function latestJobFor(meetingId) {
  return ProcessingJob.findOne({ meeting: meetingId }).sort({ createdAt: -1 });
}
