import crypto from "node:crypto";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { logger } from "../utils/logger.js";

let cachedUser = null;

/**
 * MeetAI is a personal application. When AUTH_ENABLED=false every request runs
 * as this single locally provisioned owner, so the dashboard opens without a
 * login screen while every document still carries an owner reference.
 */
export async function getLocalUser() {
  if (cachedUser) return cachedUser;

  const email = env.auth.localUserEmail;
  let user = await User.findOne({ email });

  if (!user) {
    user = await User.create({
      name: env.auth.localUserName,
      email,
      // Unusable random hash: local mode never authenticates with a password.
      passwordHash: crypto.randomBytes(32).toString("hex"),
      role: "ADMIN",
      workspaceName: "Local Workspace"
    });
    logger.info("Local workspace owner provisioned", { email });
  }

  cachedUser = user;
  return user;
}

export function resetLocalUserCache() {
  cachedUser = null;
}
