import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { applyBaseSchema, baseSchemaOptions } from "./plugins/baseSchema.js";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["ADMIN", "USER"], default: "USER", index: true },
    workspaceName: { type: String, trim: true, default: "Personal Workspace" },
    timezone: { type: String, trim: true, default: "UTC" },
    phone: { type: String, trim: true },
    avatarUrl: String,
    status: { type: String, enum: ["ACTIVE", "INVITED", "SUSPENDED"], default: "ACTIVE", index: true },
    googleAccount: {
      email: String,
      refreshToken: { type: String, select: false },
      connectedAt: Date
    },
    notion: {
      workspaceId: String,
      databaseId: String,
      connectedAt: Date
    },
    refreshTokenHash: { type: String, select: false },
    lastLoginAt: Date
  },
  baseSchemaOptions
);

userSchema.index({ email: 1, isDeleted: 1 }, { unique: true });
userSchema.index({ role: 1, status: 1, isDeleted: 1 });
applyBaseSchema(userSchema);

userSchema.statics.hashPassword = function hashPassword(password) {
  return bcrypt.hash(password, env.bcryptSaltRounds);
};

userSchema.methods.verifyPassword = function verifyPassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

export const User = mongoose.model("User", userSchema);
