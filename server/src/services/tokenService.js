import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, department: user.department }, env.jwtAccessSecret, {
    expiresIn: env.jwtAccessExpiresIn
  });
}

export function signRefreshToken(user) {
  return jwt.sign({ sub: user.id, tokenId: crypto.randomUUID() }, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn
  });
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwtRefreshSecret);
}

export function hashToken(token) {
  return bcrypt.hash(token, env.bcryptSaltRounds);
}

export function compareToken(token, hash) {
  return bcrypt.compare(token, hash);
}
