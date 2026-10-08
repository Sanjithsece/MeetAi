import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Isolated storage + email settings, applied before any app module is loaded.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meetai-pipeline-"));
Object.assign(process.env, {
  RECORDING_DIR: path.join(tmp, "recordings"),
  TRANSCRIPT_DIR: path.join(tmp, "transcripts"),
  MEETING_NOTES_DIR: path.join(tmp, "notes"),
  EMAIL_TO: "owner@example.com",
  EMAIL_NOTIFY_ON_COMPLETE: "true",
  NOTION_API_KEY: "",
  NOTION_TOKEN: "",
  CHROMA_URL: "",
  PIPELINE_RETRY_DELAY_MS: "10"
});

const analysis = {
  title: "Sprint planning",
  shortSummary: "Planned the sprint.",
  summary: "The team planned the sprint and chose MongoDB.",
  keyPoints: ["Scope agreed"],
  questions: ["Who reviews the API?"],
  followUps: ["Book design review"],
  meetingStatus: "productive",
  importantTopics: ["Sprint"],
  decisions: ["Use MongoDB"],
  actionItems: [{ task: "Write the schema", person: "Asha", deadline: "2026-10-20", priority: "HIGH" }],
  deadlines: [],
  peopleResponsible: ["Asha"],
  sentiment: "POSITIVE",
  priority: "HIGH",
  provider: "ollama",
  providerLabel: "ollama",
  model: "llama3",
  chunked: false,
  attempts: [{ provider: "ollama", outcome: "success" }]
};

const aiBehaviour = { mode: "ok" };
vi.mock("../src/services/ai/index.js", () => ({
  analyzeTranscript: vi.fn(async () => {
    if (aiBehaviour.mode === "down") {
      throw Object.assign(new Error("AI service is currently unavailable. ollama: down"), { code: "AI_PROVIDER_UNAVAILABLE" });
    }
    return analysis;
  }),
  aiManager: async () => ({ embed: async (texts) => texts.map((text) => [text.length % 7, 1, text.includes("MongoDB") ? 5 : 0]) }),
  aiHealth: async () => ({})
}));

const { Meeting } = await import("../src/models/Meeting.js");
const { Task } = await import("../src/models/Task.js");
const { ActivityLog } = await import("../src/models/ActivityLog.js");
const { EmailLog } = await import("../src/models/EmailLog.js");
const pipeline = await import("../src/services/pipeline/meetingPipeline.js");
const mail = await import("../src/services/mailService.js");
const { latestJobFor } = await import("../src/services/pipeline/jobQueue.js");
const { transcriptFile } = await import("../src/config/paths.js");

const TEST_URI = process.env.TEST_MONGODB_URI_PIPELINE ?? "mongodb://127.0.0.1:27017/meetai_test_pipeline";
let mongoAvailable = false;
try {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 3000 });
  mongoAvailable = true;
} catch {
  mongoAvailable = false;
}

beforeAll(async () => {
  if (mongoAvailable) await mongoose.connection.dropDatabase();
});
afterAll(async () => {
  mail.setTransportForTesting(null);
  if (mongoAvailable) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function waitForJob(meetingId) {
  for (let index = 0; index < 100; index += 1) {
    const job = await latestJobFor(meetingId);
    if (job && ["COMPLETED", "FAILED"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("job did not finish");
}

async function meetingWithTranscript(title) {
  const owner = new mongoose.Types.ObjectId();
  const meeting = await Meeting.create({ owner, title, startTime: new Date() });
  const file = transcriptFile(meeting._id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "Asha: let's use MongoDB. Asha will write the schema by October 20.");
  meeting.transcript = { filePath: file, status: "COMPLETED", engine: "faster-whisper", wordCount: 12 };
  await meeting.save();
  return meeting;
}

describe("email service without SMTP", () => {
  it("skips gracefully (never throws) when SMTP is not configured", async () => {
    mail.setTransportForTesting(null);
    if (mail.isEmailConfigured()) return; // developer machine with real SMTP in .env
    const result = await mail.sendNotification({ to: "a@example.com", subject: "x", message: "y" });
    expect(result.status).toBe("SKIPPED");
  });
});

(mongoAvailable ? describe : describe.skip)("meeting pipeline (analysis -> tasks -> RAG -> email) with activity tracking", () => {
  it("runs every stage and records a timeline", async () => {
    mail.setTransportForTesting({ jsonTransport: true });
    const meeting = await meetingWithTranscript("Sprint planning");

    await pipeline.queueProcessing(meeting._id);
    const job = await waitForJob(meeting._id);
    expect(job.status).toBe("COMPLETED");

    const done = await Meeting.findById(meeting._id);
    expect(done.status).toBe("COMPLETED");
    expect(done.aiAnalysis.status).toBe("COMPLETED");
    expect(done.aiAnalysis.keyPoints).toEqual(["Scope agreed"]);
    expect(done.aiAnalysis.questions).toEqual(["Who reviews the API?"]);
    expect(done.stages.analysis.status).toBe("COMPLETED");
    expect(done.stages.rag.status).toBe("COMPLETED");
    expect(done.stages.notion.status).toBe("SKIPPED");
    expect(done.stages.email.status).toBe("COMPLETED");
    expect(done.rag.chunks).toBeGreaterThan(0);
    expect(done.email.status).toBe("SENT");
    expect(fs.existsSync(done.aiAnalysis.notesPath)).toBe(true);
    expect(fs.readFileSync(done.aiAnalysis.notesPath, "utf8")).toMatch(/## Open questions/);

    const tasks = await Task.find({ meeting: meeting._id });
    expect(tasks.map((task) => task.title)).toEqual(["Write the schema"]);
    expect(tasks[0].aiGenerated).toBe(true);

    const timeline = await ActivityLog.find({ meeting: meeting._id }).sort({ createdAt: 1 });
    const stages = timeline.map((row) => `${row.stage}:${row.status}`);
    expect(stages).toEqual(expect.arrayContaining(["analysis:RUNNING", "analysis:COMPLETED", "rag:COMPLETED", "notion:SKIPPED", "email:COMPLETED"]));

    const emails = await EmailLog.find({ meeting: meeting._id });
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ kind: "MEETING_SUMMARY", status: "SENT", to: "owner@example.com" });
  });

  it("does not duplicate AI tasks when processing is re-run", async () => {
    const meeting = await Meeting.findOne({ title: "Sprint planning" });
    await pipeline.queueProcessing(meeting._id, { force: true, steps: ["analyze"] });
    await waitForJob(meeting._id);
    expect(await Task.countDocuments({ meeting: meeting._id })).toBe(1);
  });

  it("de-duplicates tasks when a re-run rephrases the same action item", async () => {
    const meeting = await Meeting.findOne({ title: "Sprint planning" });
    const original = analysis.actionItems[0].task;
    analysis.actionItems[0].task = "  write THE schema.  ";
    await pipeline.queueProcessing(meeting._id, { force: true, steps: ["analyze"] });
    await waitForJob(meeting._id);
    analysis.actionItems[0].task = original;
    expect(await Task.countDocuments({ meeting: meeting._id })).toBe(1);
  });

  it("retries a transient AI outage, then fails the stage without losing the transcript", async () => {
    aiBehaviour.mode = "down";
    const meeting = await meetingWithTranscript("Outage meeting");

    await pipeline.queueProcessing(meeting._id);
    const job = await waitForJob(meeting._id);
    aiBehaviour.mode = "ok";

    expect(job.status).toBe("FAILED");
    expect(job.error).toMatch(/unavailable/i);
    const failed = await Meeting.findById(meeting._id);
    expect(failed.status).toBe("FAILED");
    expect(failed.aiAnalysis.status).toBe("FAILED");
    expect(failed.stages.analysis.status).toBe("FAILED");
    expect(failed.transcript.status).toBe("COMPLETED");
    expect(fs.existsSync(failed.transcript.filePath)).toBe(true);
    // the transcript is still made searchable even though analysis failed
    expect(failed.stages.rag.status).toBe("COMPLETED");
    expect(failed.rag.chunks).toBeGreaterThan(0);

    const statuses = (await ActivityLog.find({ meeting: meeting._id, stage: "analysis" })).map((row) => row.status);
    expect(statuses).toEqual(expect.arrayContaining(["RUNNING", "RETRYING", "FAILED"]));
  });

  it("renders summary email HTML with user content escaped", () => {
    const html = mail.renderSummaryHtml({
      title: "<script>x</script>",
      startTime: new Date(),
      aiAnalysis: { summary: "a < b & c", keyPoints: ["<img onerror=1>"], decisions: [], actionItems: [], questions: [], followUps: [] }
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("a &lt; b &amp; c");
  });

  it("records a FAILED email (not a crash) when the SMTP server rejects", async () => {
    mail.setTransportForTesting({
      name: "broken",
      version: "1",
      send: (_mail, callback) => callback(new Error("535 Authentication failed"))
    });
    const result = await mail.sendNotification({ to: "x@example.com", subject: "s", message: "m" });
    expect(result.status).toBe("FAILED");
    expect(result.error).toMatch(/535/);
    mail.setTransportForTesting({ jsonTransport: true });
  });
});
