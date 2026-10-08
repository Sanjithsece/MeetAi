import { env } from "../../config/env.js";
import { Meeting } from "../../models/Meeting.js";
import { logger } from "../../utils/logger.js";
import { isGmailConfigured, readToken } from "../gmail/oauthClient.js";
import { syncMeetingsFromGmail } from "../gmail/gmailService.js";
import { startMeeting } from "../pipeline/meetingPipeline.js";
import { getSettings } from "../settingsService.js";

/**
 * Local cron-less scheduler.
 *
 * Ticks every MEETING_SCHEDULER_INTERVAL_SECONDS, launches Playwright
 * MEETING_JOIN_OFFSET_MINUTES before a meeting starts, and (optionally) pulls
 * new meetings out of Gmail.
 */

let timer = null;
let gmailTimer = null;
const attempted = new Set();

/** Meetings due to be joined right now. */
export async function findDueMeetings(now = new Date(), joinOffsetMinutes = env.meeting.joinOffsetMinutes) {
  const joinFrom = new Date(now.getTime() + joinOffsetMinutes * 60000);
  // Do not try to join a meeting that started more than 15 minutes ago.
  const staleAfter = new Date(now.getTime() - 15 * 60000);

  return Meeting.find({
    status: "UPCOMING",
    isDeleted: false,
    meetingUrl: { $nin: [null, ""] },
    "automation.autoJoin": true,
    startTime: { $lte: joinFrom, $gte: staleAfter }
  }).sort({ startTime: 1 });
}

async function tick() {
  try {
    const settings = await getSettings();
    if (!settings.schedulerEnabled) return;

    const due = await findDueMeetings(new Date(), settings.joinOffsetMinutes);
    for (const meeting of due) {
      const key = String(meeting._id);
      if (attempted.has(key)) continue;
      attempted.add(key);

      logger.info("Meeting scheduled for auto-join", {
        meetingId: key,
        title: meeting.title,
        startTime: meeting.startTime
      });

      startMeeting(key).catch((error) => {
        logger.error("Scheduled join failed", { meetingId: key, error: error.message });
      });
    }
  } catch (error) {
    logger.error("Scheduler tick failed", { error: error.message });
  }
}

async function gmailTick() {
  try {
    if (!env.gmail.syncEnabled || !isGmailConfigured()) return;
    if (!(await readToken())?.refreshToken) return;
    await syncMeetingsFromGmail();
  } catch (error) {
    logger.warn("Gmail sync failed", { error: error.message });
  }
}

export function startScheduler() {
  if (timer) return;
  const intervalMs = Math.max(10, env.meeting.schedulerIntervalSeconds) * 1000;
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  logger.info("Meeting scheduler started", {
    intervalSeconds: env.meeting.schedulerIntervalSeconds,
    joinOffsetMinutes: env.meeting.joinOffsetMinutes
  });

  if (env.gmail.syncEnabled && isGmailConfigured()) {
    gmailTimer = setInterval(gmailTick, Math.max(1, env.gmail.syncIntervalMinutes) * 60000);
    gmailTimer.unref?.();
    logger.info("Gmail sync scheduler started", { intervalMinutes: env.gmail.syncIntervalMinutes });
  }
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  if (gmailTimer) clearInterval(gmailTimer);
  timer = null;
  gmailTimer = null;
  attempted.clear();
}

export function schedulerState() {
  return { running: Boolean(timer), gmailSyncRunning: Boolean(gmailTimer), attemptedThisRun: attempted.size };
}
