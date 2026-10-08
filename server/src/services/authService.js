import { User } from "../models/User.js";
import { userRepository } from "../repositories/userRepository.js";
import { ApiError } from "../utils/apiError.js";
import { compareToken, hashToken, signAccessToken, signRefreshToken, verifyRefreshToken } from "./tokenService.js";
import { logger } from "../utils/logger.js";
import { sendMail } from "./mailService.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function sanitizeUser(user) {
  const object = user.toObject ? user.toObject() : user;
  delete object.passwordHash;
  delete object.refreshTokenHash;
  return object;
}

export async function register(payload) {
  const existing = await userRepository.findByEmail(payload.email);
  if (existing) throw new ApiError(409, "Email is already registered");

  const passwordHash = await User.hashPassword(payload.password);
  const { password: _password, role: _role, ...profile } = payload;
  const user = await userRepository.create({ ...profile, role: "USER", passwordHash });
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  user.refreshTokenHash = await hashToken(refreshToken);
  await user.save();

  // Best-effort: a mail problem must never fail a registration that already succeeded.
  await sendMail({
    to: user.email,
    subject: "Welcome to MeetAI",
    html: `<p>Hello ${escapeHtml(user.name)}, your MeetAI workspace is ready.</p>`,
    kind: "WELCOME",
    owner: user._id
  }).catch((error) => logger.warn("Welcome email failed", { error: error.message }));

  return { user: sanitizeUser(user), accessToken, refreshToken };
}

export async function login({ email, password }) {
  const user = await userRepository.findByEmail(email);
  if (!user || !(await user.verifyPassword(password))) {
    throw new ApiError(401, "Invalid email or password");
  }
  if (user.status !== "ACTIVE") throw new ApiError(403, "User account is not active");

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  user.refreshTokenHash = await hashToken(refreshToken);
  user.lastLoginAt = new Date();
  await user.save();

  return { user: sanitizeUser(user), accessToken, refreshToken };
}

export async function refresh(refreshToken) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new ApiError(401, "Invalid refresh token", undefined, "INVALID_TOKEN");
  }
  const user = await userRepository.findById(payload.sub).select("+refreshTokenHash");
  if (!user?.refreshTokenHash || !(await compareToken(refreshToken, user.refreshTokenHash))) {
    throw new ApiError(401, "Invalid refresh token");
  }
  return { accessToken: signAccessToken(user) };
}

export async function logout(userId) {
  await userRepository.update(userId, { refreshTokenHash: null });
}
