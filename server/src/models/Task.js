import mongoose from "mongoose";
import { applyBaseSchema, baseSchemaOptions } from "./plugins/baseSchema.js";

const taskSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    meeting: { type: mongoose.Schema.Types.ObjectId, ref: "Meeting", index: true },
    title: { type: String, required: true, trim: true },
    description: String,
    assigneeName: String,
    assigneeEmail: { type: String, lowercase: true, trim: true },
    deadline: Date,
    reminderAt: Date,
    priority: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], default: "MEDIUM", index: true },
    status: { type: String, enum: ["PENDING", "IN_PROGRESS", "COMPLETED"], default: "PENDING", index: true },
    aiGenerated: { type: Boolean, default: false },
    sourceActionItem: String,
    completedAt: Date
  },
  baseSchemaOptions
);

taskSchema.index({ owner: 1, status: 1, deadline: 1, isDeleted: 1 });
applyBaseSchema(taskSchema);

export const Task = mongoose.model("Task", taskSchema);
