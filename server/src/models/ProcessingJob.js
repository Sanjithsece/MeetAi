import mongoose from "mongoose";

export const JOB_TYPES = ["TRANSCRIBE", "ANALYZE", "NOTION", "FULL_PIPELINE", "RECORD"];
export const JOB_STATUSES = ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"];

/**
 * Durable record of background work so the dashboard can poll progress and a
 * crashed job is still visible after a restart.
 */
const processingJobSchema = new mongoose.Schema(
  {
    meeting: { type: mongoose.Schema.Types.ObjectId, ref: "Meeting", required: true, index: true },
    type: { type: String, enum: JOB_TYPES, required: true },
    status: { type: String, enum: JOB_STATUSES, default: "QUEUED", index: true },
    step: String,
    progress: { type: Number, default: 0, min: 0, max: 100 },
    error: String,
    startedAt: Date,
    finishedAt: Date
  },
  { timestamps: true, versionKey: false, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

processingJobSchema.index({ meeting: 1, createdAt: -1 });

export const ProcessingJob = mongoose.model("ProcessingJob", processingJobSchema);
