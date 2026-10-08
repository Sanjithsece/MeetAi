import mongoose from "mongoose";
import { applyBaseSchema, baseSchemaOptions } from "./plugins/baseSchema.js";

/**
 * Meeting lifecycle. `UPCOMING` is the "not started" state; every later value is
 * driven by the automation pipeline (join -> record -> transcribe -> analyse).
 */
export const MEETING_STATUSES = [
  "UPCOMING",
  "JOINING",
  "RECORDING",
  "RECORDING_COMPLETED",
  "RECORDING_FAILED",
  "TRANSCRIBING",
  "ANALYZING",
  "COMPLETED",
  "FAILED",
  "CANCELLED"
];

export const MEETING_SOURCES = ["MANUAL", "GMAIL", "GOOGLE_CALENDAR", "IMPORT"];
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const participantSchema = new mongoose.Schema(
  {
    name: String,
    email: { type: String, lowercase: true, trim: true },
    role: { type: String, enum: ["ORGANIZER", "ATTENDEE"], default: "ATTENDEE" }
  },
  { _id: false }
);

const actionItemSchema = new mongoose.Schema(
  {
    task: { type: String, required: true, trim: true },
    person: { type: String, trim: true },
    deadline: { type: String, trim: true },
    priority: { type: String, enum: PRIORITIES, default: "MEDIUM" }
  },
  { _id: false }
);

/**
 * Only metadata and the local file path live in MongoDB - the MP4 itself always
 * stays on disk under RECORDING_DIR/<meeting id>/meeting.mp4 .
 */
const recordingSchema = new mongoose.Schema(
  {
    filePath: String,
    format: { type: String, default: "mp4" },
    durationSeconds: Number,
    sizeBytes: Number,
    recordedAt: Date,
    recorder: String,
    error: String
  },
  { _id: false }
);

const transcriptSchema = new mongoose.Schema(
  {
    filePath: String,
    status: { type: String, enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"], default: "PENDING" },
    engine: String,
    language: String,
    wordCount: Number,
    generatedAt: Date,
    error: String
  },
  { _id: false }
);

const aiAnalysisSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"], default: "PENDING" },
    provider: String,
    model: String,
    title: String,
    shortSummary: String,
    summary: String,
    keyPoints: [String],
    questions: [String],
    followUps: [String],
    meetingStatus: String,
    importantTopics: [String],
    decisions: [String],
    actionItems: [actionItemSchema],
    deadlines: [{ _id: false, label: String, date: String, person: String }],
    peopleResponsible: [String],
    sentiment: { type: String, enum: ["POSITIVE", "NEUTRAL", "NEGATIVE", "MIXED"], default: "NEUTRAL" },
    priority: { type: String, enum: PRIORITIES, default: "MEDIUM" },
    notesPath: String,
    generatedAt: Date,
    chunked: Boolean,
    attempts: [{ _id: false, provider: String, outcome: String, kind: String, message: String }],
    error: String
  },
  { _id: false }
);

/** Per-stage state for the dashboard: PENDING | RUNNING | COMPLETED | FAILED | RETRYING | SKIPPED. */
const stageSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["PENDING", "RUNNING", "COMPLETED", "FAILED", "RETRYING", "SKIPPED"], default: "PENDING" },
    updatedAt: Date,
    detail: String
  },
  { _id: false }
);

const notionSchema = new mongoose.Schema(
  {
    pageId: String,
    pageUrl: String,
    createdAt: Date,
    error: String
  },
  { _id: false }
);

const meetingSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    description: { type: String, trim: true, default: "" },
    meetingUrl: { type: String, trim: true, default: "" },
    date: { type: Date, index: true },
    startTime: { type: Date, required: true, index: true },
    endTime: Date,
    participants: { type: [participantSchema], default: [] },
    source: { type: String, enum: MEETING_SOURCES, default: "MANUAL", index: true },
    status: { type: String, enum: MEETING_STATUSES, default: "UPCOMING", index: true },
    priority: { type: String, enum: PRIORITIES, default: "MEDIUM", index: true },
    tags: { type: [String], default: [] },
    notes: { type: String, default: "" },

    recording: { type: recordingSchema, default: () => ({}) },
    transcript: { type: transcriptSchema, default: () => ({}) },
    aiAnalysis: { type: aiAnalysisSchema, default: () => ({}) },
    notion: { type: notionSchema, default: () => ({}) },
    rag: {
      status: { type: String, enum: ["PENDING", "COMPLETED", "FAILED", "SKIPPED"], default: "PENDING" },
      chunks: Number,
      store: String,
      indexedAt: Date,
      error: String
    },
    email: {
      status: { type: String, enum: ["PENDING", "SENT", "FAILED", "SKIPPED"], default: "PENDING" },
      to: String,
      sentAt: Date,
      error: String
    },
    stages: {
      join: { type: stageSchema, default: () => ({}) },
      recording: { type: stageSchema, default: () => ({}) },
      transcription: { type: stageSchema, default: () => ({}) },
      analysis: { type: stageSchema, default: () => ({}) },
      rag: { type: stageSchema, default: () => ({}) },
      notion: { type: stageSchema, default: () => ({}) },
      email: { type: stageSchema, default: () => ({}) }
    },

    automation: {
      autoJoin: { type: Boolean, default: true },
      autoRecord: { type: Boolean, default: true },
      autoProcess: { type: Boolean, default: true },
      joinedAt: Date,
      leftAt: Date,
      lastError: String
    },

    /** Deduplication keys for Gmail/Calendar ingestion. */
    externalId: { type: String, index: true, sparse: true },
    sourceMessageId: { type: String, index: true, sparse: true },

    statusHistory: {
      type: [{ _id: false, status: String, at: Date, detail: String }],
      default: []
    }
  },
  baseSchemaOptions
);

meetingSchema.index({ owner: 1, startTime: -1, status: 1, isDeleted: 1 });
meetingSchema.index({ title: "text", notes: "text", "aiAnalysis.summary": "text" });

meetingSchema.pre("validate", function syncDate(next) {
  if (this.startTime) {
    const start = new Date(this.startTime);
    this.date = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  }
  next();
});

meetingSchema.virtual("durationMinutes").get(function durationMinutes() {
  if (!this.startTime || !this.endTime) return null;
  return Math.max(0, Math.round((this.endTime - this.startTime) / 60000));
});

meetingSchema.methods.pushStatus = function pushStatus(status, detail) {
  this.status = status;
  this.statusHistory.push({ status, at: new Date(), detail });
  if (this.statusHistory.length > 50) this.statusHistory = this.statusHistory.slice(-50);
  return this;
};

applyBaseSchema(meetingSchema);

export const Meeting = mongoose.model("Meeting", meetingSchema);
