import { env } from "../config/env.js";
import { EmailLog } from "../models/EmailLog.js";
import { Meeting } from "../models/Meeting.js";
import { meetingTimeline, recentActivity } from "../services/activityService.js";
import { aiHealth } from "../services/ai/index.js";
import { getAIManager } from "../services/ai/aiServiceManager.js";
import { sendActionItems, sendNotification, sendTranscript } from "../services/mailService.js";
import { runEmail } from "../services/pipeline/meetingPipeline.js";
import fsp from "node:fs/promises";
import { fileExists } from "../config/paths.js";
import { ApiError } from "../utils/apiError.js";
import { success } from "../utils/apiResponse.js";

async function ownedMeeting(req) {
  const meeting = await Meeting.findOne({ _id: req.params.id, owner: req.user._id, isDeleted: false });
  if (!meeting) throw new ApiError(404, "Meeting not found");
  return meeting;
}

export const activityController = {
  async recent(req, res, next) {
    try {
      success(res, await recentActivity(req.user._id, req.query.limit));
    } catch (error) {
      next(error);
    }
  },

  async timeline(req, res, next) {
    try {
      const meeting = await ownedMeeting(req);
      success(res, { stages: meeting.stages, timeline: await meetingTimeline(meeting._id) });
    } catch (error) {
      next(error);
    }
  },

  /** POST /meetings/:id/email { kind: summary|transcript|actions, to? } */
  async emailMeeting(req, res, next) {
    try {
      const meeting = await ownedMeeting(req);
      const to = req.body.to || env.email.to || req.user.email;
      const kind = req.body.kind ?? "summary";
      let result;
      if (kind === "summary") {
        result = await runEmail(meeting._id, { to });
      } else if (kind === "actions") {
        if (meeting.aiAnalysis?.status !== "COMPLETED") throw new ApiError(409, "AI analysis has not completed yet");
        result = await sendActionItems({ meeting, to });
      } else {
        const path = meeting.transcript?.filePath;
        if (!path || !(await fileExists(path))) throw new ApiError(404, "No transcript is available for this meeting");
        result = await sendTranscript({ meeting, to, transcriptText: await fsp.readFile(path, "utf8") });
      }
      success(res, result, result.status === "SENT" ? "Email sent" : `Email ${String(result.status).toLowerCase()}`);
    } catch (error) {
      next(error);
    }
  },

  async testEmail(req, res, next) {
    try {
      const to = req.body.to || env.email.to || req.user.email;
      const result = await sendNotification({ to, owner: req.user._id, subject: "MeetAI test email", message: "Email notifications from MeetAI are working." });
      success(res, result, result.status === "SENT" ? "Test email sent" : `Email ${String(result.status).toLowerCase()}`);
    } catch (error) {
      next(error);
    }
  },

  async emailLog(req, res, next) {
    try {
      success(res, await EmailLog.find({ owner: req.user._id }).sort({ createdAt: -1 }).limit(100).lean());
    } catch (error) {
      next(error);
    }
  },

  async aiStatus(_req, res, next) {
    try {
      success(res, await aiHealth());
    } catch (error) {
      next(error);
    }
  },

  /** Clears cooldowns / disabled keys after the user fixes a key in .env and restarts, or wants to retry now. */
  async aiReset(_req, res, next) {
    try {
      getAIManager().reset();
      success(res, await aiHealth(), "AI provider state reset");
    } catch (error) {
      next(error);
    }
  }
};
