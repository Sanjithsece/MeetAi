import { User } from "../models/User.js";

export const userRepository = {
  create(payload) {
    return User.create(payload);
  },
  findById(id) {
    return User.findById(id);
  },
  findByEmail(email) {
    return User.findOne({ email: email.toLowerCase() }).select("+passwordHash +refreshTokenHash");
  },
  update(id, payload) {
    return User.findByIdAndUpdate(id, payload, { new: true, runValidators: true });
  },
  async list(filter = {}, { page = 1, limit = 20, sort = "-createdAt" } = {}) {
    const skip = (Math.max(Number(page), 1) - 1) * Math.min(Number(limit), 100);
    const safeLimit = Math.min(Number(limit), 100);
    const [items, total] = await Promise.all([
      User.find(filter).select("-passwordHash -refreshTokenHash").sort(sort).skip(skip).limit(safeLimit),
      User.countDocuments(filter)
    ]);
    return { items, meta: { page: Number(page), limit: safeLimit, total, pages: Math.ceil(total / safeLimit) || 1 } };
  }
};
