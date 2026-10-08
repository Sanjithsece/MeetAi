import { Notification } from "../models/Notification.js";
import { success } from "../utils/apiResponse.js";

export const notificationController = {
  async list(req, res, next) {
    try {
      const items = await Notification.find({ owner: req.user._id, isDeleted: false })
        .sort({ createdAt: -1 })
        .limit(Math.min(Math.max(Number(req.query.limit) || 50, 1), 100));
      success(res, items, "Notifications");
    } catch (error) {
      next(error);
    }
  },

  async markRead(req, res, next) {
    try {
      const item = await Notification.findOneAndUpdate(
        { _id: req.params.id, owner: req.user._id },
        { status: "READ" },
        { new: true }
      );
      success(res, item, "Notification updated");
    } catch (error) {
      next(error);
    }
  }
};
