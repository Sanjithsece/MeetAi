import mongoose from "mongoose";

/**
 * Single-document store for settings the user can edit from the Settings page.
 * Anything left `null` falls back to the matching value in `.env`, so the file
 * stays the source of truth and no secret ever needs to live in MongoDB.
 */
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, default: "local", unique: true, index: true },
    aiProvider: { type: String, enum: ["auto", "ollama", "gemini", null], default: null },
    ollamaUrl: { type: String, default: null },
    ollamaModel: { type: String, default: null },
    whisperImplementation: { type: String, default: null },
    whisperModel: { type: String, default: null },
    whisperLanguage: { type: String, default: null },
    joinOffsetMinutes: { type: Number, default: null },
    schedulerEnabled: { type: Boolean, default: null },
    autoProcessAfterRecording: { type: Boolean, default: true },
    createTasksFromActionItems: { type: Boolean, default: true },
    recorderAudioDevice: { type: String, default: null },
    meetingDisplayName: { type: String, default: null }
  },
  { timestamps: true, versionKey: false }
);

export const Setting = mongoose.model("Setting", settingSchema);
