import mongoose from "mongoose";

export const ACTIVITY_STATES = ["PENDING", "RUNNING", "COMPLETED", "FAILED", "RETRYING", "SKIPPED", "INFO"];
export const ACTIVITY_STAGES = ["meeting", "join", "recording", "transcription", "analysis", "rag", "notion", "email", "system"];

/** One row per pipeline event - powers the per-meeting timeline and dashboard feed. */
const activityLogSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    meeting: { type: mongoose.Schema.Types.ObjectId, ref: "Meeting", index: true },
    meetingTitle: String,
    stage: { type: String, enum: ACTIVITY_STAGES, required: true },
    status: { type: String, enum: ACTIVITY_STATES, required: true },
    message: { type: String, required: true, maxlength: 1000 },
    meta: mongoose.Schema.Types.Mixed
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, toJSON: { virtuals: true } }
);

activityLogSchema.index({ meeting: 1, createdAt: 1 });
activityLogSchema.index({ owner: 1, createdAt: -1 });

export const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);
