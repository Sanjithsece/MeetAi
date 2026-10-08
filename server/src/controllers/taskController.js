import { Task } from "../models/Task.js";
import { ApiError } from "../utils/apiError.js";
import { success } from "../utils/apiResponse.js";

function ownerFilter(req) {
  return { owner: req.user._id, isDeleted: false };
}

export const taskController = {
  async list(req, res, next) {
    try {
      const filter = ownerFilter(req);
      if (req.query.status) filter.status = req.query.status;
      if (req.query.meeting) filter.meeting = req.query.meeting;
      if (req.query.overdue === "true") {
        filter.status = { $ne: "COMPLETED" };
        filter.deadline = { $lt: new Date() };
      }

      const tasks = await Task.find(filter).sort({ status: 1, deadline: 1, createdAt: -1 }).limit(Math.min(Math.max(Number(req.query.limit) || 200, 1), 500));
      success(res, tasks, "Tasks");
    } catch (error) {
      next(error);
    }
  },

  async create(req, res, next) {
    try {
      const task = await Task.create({ ...req.body, owner: req.user._id });
      success(res, task, "Task created", 201);
    } catch (error) {
      next(error);
    }
  },

  async update(req, res, next) {
    try {
      const updates = { ...req.body };
      if (updates.status === "COMPLETED") updates.completedAt = new Date();
      if (updates.status && updates.status !== "COMPLETED") updates.completedAt = null;

      const task = await Task.findOneAndUpdate({ _id: req.params.id, ...ownerFilter(req) }, updates, {
        new: true,
        runValidators: true
      });
      if (!task) throw new ApiError(404, "Task not found");
      success(res, task, "Task updated");
    } catch (error) {
      next(error);
    }
  },

  async remove(req, res, next) {
    try {
      const task = await Task.findOne({ _id: req.params.id, ...ownerFilter(req) });
      if (!task) throw new ApiError(404, "Task not found");
      await task.softDelete(req.user._id);
      success(res, { id: task._id }, "Task deleted");
    } catch (error) {
      next(error);
    }
  }
};
