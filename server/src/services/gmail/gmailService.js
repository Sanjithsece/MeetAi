import { env } from "../../config/env.js";
import { Meeting } from "../../models/Meeting.js";
import { logger } from "../../utils/logger.js";
import { getLocalUser } from "../localUserService.js";
import { getAccessToken, isGmailConfigured } from "./oauthClient.js";
import { parseMeetingFromMessage } from "./meetingParser.js";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Narrow query: only messages that plausibly carry a meeting link. */
function buildQuery(lookbackDays) {
  return [
    `newer_than:${Math.max(1, lookbackDays)}d`,
    "(meet.google.com OR zoom.us/j OR teams.microsoft.com/l/meetup-join OR invite.ics OR \"Invitation:\")"
  ].join(" ");
}

async function gmailRequest(path, accessToken) {
  const response = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gmail API request failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  return response.json();
}

function decodeBase64Url(data = "") {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** Walks the MIME tree and returns the first text/plain (or html) body. */
function extractBody(payload) {
  if (!payload) return "";
  const parts = [payload, ...(payload.parts ?? [])];
  const flatten = (part) => (part.parts ? [part, ...part.parts.flatMap(flatten)] : [part]);
  const all = parts.flatMap(flatten);

  const plain = all.find((part) => part.mimeType === "text/plain" && part.body?.data);
  if (plain) return decodeBase64Url(plain.body.data);

  const html = all.find((part) => part.mimeType === "text/html" && part.body?.data);
  if (html) {
    return decodeBase64Url(html.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&");
  }
  return "";
}

function headerMap(headers = []) {
  return Object.fromEntries(headers.map((header) => [header.name.toLowerCase(), header.value]));
}

/**
 * Reads the user's own Gmail, extracts meeting candidates and upserts them.
 * Deduplicated on `sourceMessageId` first, then on meeting URL + start time.
 */
export async function syncMeetingsFromGmail({ lookbackDays = env.gmail.lookbackDays, maxMessages = 40 } = {}) {
  if (!isGmailConfigured()) {
    return { skipped: true, reason: "Gmail is not configured", created: 0, updated: 0, scanned: 0 };
  }

  const accessToken = await getAccessToken();
  const owner = await getLocalUser();
  const query = encodeURIComponent(buildQuery(lookbackDays));
  const list = await gmailRequest(`/messages?q=${query}&maxResults=${maxMessages}`, accessToken);
  const messages = list.messages ?? [];

  let created = 0;
  let updated = 0;

  for (const { id } of messages) {
    try {
      const existingByMessage = await Meeting.findOne({ sourceMessageId: id });
      if (existingByMessage) continue;

      const message = await gmailRequest(`/messages/${id}?format=full`, accessToken);
      const draft = parseMeetingFromMessage({
        headers: headerMap(message.payload?.headers),
        body: extractBody(message.payload),
        internalDate: message.internalDate,
        messageId: id
      });
      if (!draft) continue;

      const duplicate = await Meeting.findOne({
        owner: owner._id,
        meetingUrl: draft.meetingUrl,
        startTime: {
          $gte: new Date(draft.startTime.getTime() - 60 * 60 * 1000),
          $lte: new Date(draft.startTime.getTime() + 60 * 60 * 1000)
        }
      });

      if (duplicate) {
        duplicate.sourceMessageId = id;
        if (!duplicate.participants.length) duplicate.participants = draft.participants;
        await duplicate.save();
        updated += 1;
        continue;
      }

      await Meeting.create({ ...draft, owner: owner._id });
      created += 1;
      logger.info("Meeting detected", { source: "GMAIL", title: draft.title, startTime: draft.startTime });
    } catch (error) {
      logger.warn("Gmail message could not be processed", { messageId: id, error: error.message });
    }
  }

  logger.info("Gmail sync completed", { scanned: messages.length, created, updated });
  return { skipped: false, scanned: messages.length, created, updated };
}
