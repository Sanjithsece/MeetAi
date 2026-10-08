import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileExists, isManagedPath } from "../config/paths.js";
import { Meeting } from "../models/Meeting.js";
import { Task } from "../models/Task.js";
import { activeJobFor, latestJobFor } from "../services/pipeline/jobQueue.js";
import * as pipeline from "../services/pipeline/meetingPipeline.js";
import { isRecording } from "../services/recording/recorder.js";
import { isJoined } from "../services/automation/meetBot.js";
import { removeMeeting as removeFromIndex } from "../services/rag/ragService.js";
import { ApiError } from "../utils/apiError.js";
import { success } from "../utils/apiResponse.js";
import { getPagination, paginationMeta } from "../utils/pagination.js";

/** User text is matched literally - never interpreted as a regular expression. */
export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ownerFilter(req) {
  return { owner: req.user._id, isDeleted: false };
}

async function findMeeting(req) {
  const meeting = await Meeting.findOne({ _id: req.params.id, ...ownerFilter(req) });
  if (!meeting) throw new ApiError(404, "Meeting not found");
  return meeting;
}

const SORTS = {
  newest: { startTime: -1 },
  oldest: { startTime: 1 },
  title: { title: 1 },
  priority: { priority: -1, startTime: -1 }
};

export const meetingController = {
  async list(req, res, next) {
    try {
      const filter = ownerFilter(req);
      const { status, source, priority, search, from, to, scope } = req.query;

      if (status) filter.status = { $in: String(status).split(",") };
      if (source) filter.source = source;
      if (priority) filter.priority = priority;
      if (search) filter.title = { $regex: escapeRegex(String(search).trim().slice(0, 120)), $options: "i" };
      if (from || to) {
        filter.startTime = {};
        if (from) filter.startTime.$gte = new Date(from);
        if (to) filter.startTime.$lte = new Date(to);
      }

      const now = new Date();
      if (scope === "upcoming") {
        filter.startTime = { ...(filter.startTime ?? {}), $gte: now };
        filter.status = filter.status ?? { $in: ["UPCOMING", "JOINING"] };
      } else if (scope === "previous") {
        filter.startTime = { ...(filter.startTime ?? {}), $lt: now };
      } else if (scope === "today") {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = new Date(start.getTime() + 24 * 3600 * 1000);
        filter.startTime = { $gte: start, $lt: end };
      } else if (scope === "recorded") {
        filter["recording.filePath"] = { $nin: [null, ""] };
      }

      const { page, limit, skip } = getPagination(req.query);
      const sort = SORTS[req.query.sort] ?? SORTS.newest;

      const [items, total] = await Promise.all([
        Meeting.find(filter).sort(sort).skip(skip).limit(limit),
        Meeting.countDocuments(filter)
      ]);

      success(res, items, "Meetings", 200, paginationMeta({ page, limit, total }));
    } catch (error) {
      next(error);
    }
  },

  async create(req, res, next) {
    try {
      const meeting = await Meeting.create({ ...req.body, owner: req.user._id });
      success(res, meeting, "Meeting created", 201);
    } catch (error) {
      next(error);
    }
  },

  async get(req, res, next) {
    try {
      const meeting = await findMeeting(req);
      const [tasks, job] = await Promise.all([
        Task.find({ meeting: meeting._id, isDeleted: false }).sort({ createdAt: 1 }),
        latestJobFor(meeting._id)
      ]);

      success(res, {
        meeting,
        tasks,
        job,
        live: { joined: isJoined(meeting._id), recording: isRecording(meeting._id), joining: pipeline.isJoining(meeting._id) },
        files: {
          recording: await fileExists(meeting.recording?.filePath),
          transcript: await fileExists(meeting.transcript?.filePath),
          notes: await fileExists(meeting.aiAnalysis?.notesPath)
        }
      });
    } catch (error) {
      next(error);
    }
  },

  async update(req, res, next) {
    try {
      const meeting = await findMeeting(req);
      Object.assign(meeting, req.body);
      await meeting.save();
      success(res, meeting, "Meeting updated");
    } catch (error) {
      next(error);
    }
  },

  async remove(req, res, next) {
    try {
      const meeting = await findMeeting(req);
      await meeting.softDelete(req.user._id);
      // A deleted meeting must stop showing up in search answers.
      await removeFromIndex(meeting).catch(() => undefined);
      success(res, { id: meeting._id }, "Meeting deleted");
    } catch (error) {
      next(error);
    }
  },

  /**
   * Streams the local MP4 with HTTP range support so the browser video player
   * can seek. The file never leaves the machine - it is read straight from
   * RECORDING_DIR and only if it still lives inside a managed directory.
   */
  async streamRecording(req, res, next) {
    try {
      const meeting = await findMeeting(req);
      const filePath = meeting.recording?.filePath;

      if (!filePath || !isManagedPath(filePath) || !(await fileExists(filePath))) {
        throw new ApiError(404, "No recording is available for this meeting");
      }

      const { size } = await fsp.stat(filePath);
      const range = req.headers.range;

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Disposition", `inline; filename="${path.basename(filePath)}"`);

      if (!range) {
        res.setHeader("Content-Length", size);
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1;

      if (Number.isNaN(start) || start >= size || start > end) {
        res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
        return;
      }

      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      res.setHeader("Content-Length", end - start + 1);
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } catch (error) {
      next(error);
    }
  },

  async transcript(req, res, next) {
    try {
      const meeting = await findMeeting(req);
      const filePath = meeting.transcript?.filePath;

      if (!filePath || !isManagedPath(filePath) || !(await fileExists(filePath))) {
        throw new ApiError(404, "No transcript is available for this meeting");
      }

      const text = await fsp.readFile(filePath, "utf8");

      if (req.query.download === "true") {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        const safeName = meeting.title.replace(/[^\w -]/g, "").trim() || "transcript";
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}.txt"`);
        res.send(text);
        return;
      }

      success(res, { text, meta: meeting.transcript });
    } catch (error) {
      next(error);
    }
  },

  async notes(req, res, next) {
    try {
      const meeting = await findMeeting(req);
      const filePath = meeting.aiAnalysis?.notesPath;
      if (!filePath || !isManagedPath(filePath) || !(await fileExists(filePath))) {
        throw new ApiError(404, "No meeting notes have been generated yet");
      }
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.send(await fsp.readFile(filePath, "utf8"));
    } catch (error) {
      next(error);
    }
  },

  /** Joins the meeting now with the persistent browser profile. */
  async start(req, res, next) {
    try {
      const meeting = await findMeeting(req);
      const result = await pipeline.startMeeting(meeting._id, { record: req.body?.record !== false });
      success(
        res,
        result,
        result.joining
          ? "Joining in the background - it retries and waits for the host to let it in. Follow the Activity tab."
          : result.recording
            ? "Meeting joined and recording"
            : "Meeting joined",
        result.joining ? 202 : 200
      );
    } catch (error) {
      next(error.statusCode ? error : new ApiError(400, error.message));
    }
  },

  async stop(req, res, next) {
    try {
      const meeting = await findMeeting(req);
      const result = await pipeline.stopMeeting(meeting._id, { process: req.body?.process });
      success(res, result, result.cancelled ? "Join cancelled" : "Meeting stopped");
    } catch (error) {
      next(error.statusCode ? error : new ApiError(400, error.message));
    }
  },

  /** Queues transcription + analysis + Notion in the background. */
  async process(req, res, next) {
    try {
      const meeting = await findMeeting(req);
      const existing = await activeJobFor(meeting._id);
      if (existing && !req.body?.force) {
        success(res, existing, "Processing already in progress", 202);
        return;
      }
      const job = await pipeline.queueProcessing(meeting._id, {
        steps: req.body?.steps,
        force: req.body?.force ?? false
      });
      success(res, job, "Processing queued", 202);
    } catch (error) {
      next(error.statusCode ? error : new ApiError(400, error.message));
    }
  },

  async job(req, res, next) {
    try {
      const meeting = await findMeeting(req);
      success(res, await latestJobFor(meeting._id));
    } catch (error) {
      next(error);
    }
  }
};
