import mongoose from "mongoose";
import { applyBaseSchema, baseSchemaOptions } from "./plugins/baseSchema.js";

const notificationSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    channel: { type: String, enum: ["APP", "EMAIL", "WHATSAPP", "TELEGRAM"], default: "APP" },
    status: { type: String, enum: ["UNREAD", "READ", "SENT", "FAILED"], default: "UNREAD", index: true },
    metadata: mongoose.Schema.Types.Mixed
  },
  baseSchemaOptions
);

applyBaseSchema(notificationSchema);
export const Notification = mongoose.model("Notification", notificationSchema);
