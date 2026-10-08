import { ActivityLog } from "../models/ActivityLog.js";
import { meetingLogger } from "../utils/logger.js";

/**
 * Records a pipeline event. Never throws - activity tracking must not be able
 * to break the meeting workflow it describes.
 */
export async function recordActivity({ meeting, owner, stage, status, message, meta }) {
  meetingLogger.info(`[${stage}] ${status}: ${message}`, { meetingId: meeting?._id ? String(meeting._id) : undefined, ...(meta ? { meta } : {}) });
  try {
    if (meeting?.stages?.[stage] && status !== "INFO") {
      meeting.stages[stage] = { status, updatedAt: new Date(), detail: message.slice(0, 300) };
    }
    return await ActivityLog.create({
      owner: owner ?? meeting?.owner,
      meeting: meeting?._id,
      meetingTitle: meeting?.title,
      stage,
      status,
      message: String(message).slice(0, 1000),
      meta
    });
  } catch (error) {
    meetingLogger.warn("Activity log write failed", { error: error.message });
    return null;
  }
}

export function meetingTimeline(meetingId) {
  return ActivityLog.find({ meeting: meetingId }).sort({ createdAt: 1 }).limit(500).lean();
}

export function recentActivity(owner, limit = 30) {
  return ActivityLog.find({ owner }).sort({ createdAt: -1 }).limit(Math.min(Math.max(Number(limit) || 30, 1), 200)).lean();
}
