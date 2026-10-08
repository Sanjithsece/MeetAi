import mongoose from "mongoose";

/** Audit trail of every email MeetAI attempted. Never stores SMTP credentials or the body. */
const emailLogSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    meeting: { type: mongoose.Schema.Types.ObjectId, ref: "Meeting", index: true },
    kind: { type: String, enum: ["MEETING_SUMMARY", "TRANSCRIPT", "ACTION_ITEMS", "NOTIFICATION", "DAILY_DIGEST", "TEST", "WELCOME"], required: true },
    to: { type: String, required: true },
    subject: String,
    status: { type: String, enum: ["SENT", "FAILED", "SKIPPED"], required: true },
    messageId: String,
    error: String
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, toJSON: { virtuals: true } }
);

emailLogSchema.index({ owner: 1, createdAt: -1 });

export const EmailLog = mongoose.model("EmailLog", emailLogSchema);
