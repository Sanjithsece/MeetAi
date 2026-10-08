/**
 * Turns a Gmail message into a meeting candidate.
 *
 * Only the fields MeetAI actually needs are extracted (title, URL, date, time,
 * participants). The message body is parsed in memory and never stored.
 */

const MEET_URL = /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:\?[^\s"'<>]*)?/i;
const ZOOM_URL = /https:\/\/[a-z0-9.-]*zoom\.us\/j\/\d+(?:\?[^\s"'<>]*)?/i;
const TEAMS_URL = /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"'<>]+/i;

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

export function extractMeetingUrl(text = "") {
  const match = text.match(MEET_URL) ?? text.match(ZOOM_URL) ?? text.match(TEAMS_URL);
  if (!match) return null;
  // Calendar invites often wrap the link in tracking params; keep the bare URL.
  return match[0].replace(/&amp;/g, "&").replace(/[).,]+$/, "");
}

/** Cleans a Google Calendar invite subject such as "Invitation: Standup @ Mon Aug 24". */
export function cleanTitle(subject = "") {
  return subject
    .replace(/^(invitation|updated invitation|accepted|declined|canceled|cancelled|fwd|re):\s*/i, "")
    .replace(/\s*@\s*.*$/, "")
    .replace(/\s*\((.*)\)\s*$/, "")
    .trim();
}

function parseTimeToken(token) {
  const match = String(token).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * Understands the "When:" line Google Calendar puts in invitation emails, e.g.
 *   "Mon Aug 24, 2026 10:00am - 11:00am (IST)"
 * Falls back to `null` so the caller can use the message date instead.
 */
export function extractSchedule(text = "", referenceYear = new Date().getFullYear()) {
  const whenLine = text.match(/^\s*When:?\s*(.+)$/im)?.[1] ?? text;

  const dateMatch =
    whenLine.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/) ??
    whenLine.match(/([A-Za-z]{3,})\s+(\d{1,2}),?\s*(\d{4})?/);
  if (!dateMatch) return null;

  let day;
  let monthToken;
  let year;
  if (/^\d/.test(dateMatch[1])) {
    day = Number(dateMatch[1]);
    monthToken = dateMatch[2];
    year = Number(dateMatch[3] ?? referenceYear);
  } else {
    monthToken = dateMatch[1];
    day = Number(dateMatch[2]);
    year = Number(dateMatch[3] ?? referenceYear);
  }

  const month = MONTHS[String(monthToken).slice(0, 3).toLowerCase()];
  if (month === undefined || !Number.isFinite(day)) return null;

  const times = [...whenLine.matchAll(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))/gi)].map((match) => parseTimeToken(match[1]));
  const start = times[0] ?? parseTimeToken(whenLine.match(/(\d{1,2}:\d{2})/)?.[1] ?? "") ?? { hours: 9, minutes: 0 };
  const startTime = new Date(year, month, day, start.hours, start.minutes, 0, 0);

  let endTime = null;
  if (times[1]) {
    endTime = new Date(year, month, day, times[1].hours, times[1].minutes, 0, 0);
    if (endTime <= startTime) endTime = new Date(endTime.getTime() + 24 * 3600 * 1000);
  }

  return { startTime, endTime };
}

export function extractParticipants(headers = {}, body = "") {
  const addresses = new Set();
  const push = (value) => {
    for (const match of String(value ?? "").matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) {
      addresses.add(match[0].toLowerCase());
    }
  };

  push(headers.from);
  push(headers.to);
  push(headers.cc);
  const guestBlock = body.match(/^\s*(?:Guests|Attendees|Participants):?\s*([\s\S]{0,600})$/im)?.[1];
  if (guestBlock) push(guestBlock);

  const organizer = String(headers.from ?? "").match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0]?.toLowerCase();

  return [...addresses].slice(0, 40).map((email) => ({
    email,
    name: "",
    role: email === organizer ? "ORGANIZER" : "ATTENDEE"
  }));
}

/**
 * @returns a meeting draft, or null when the message holds no meeting link.
 */
export function parseMeetingFromMessage({ headers = {}, body = "", internalDate, messageId }) {
  const haystack = `${headers.subject ?? ""}\n${body}`;
  const meetingUrl = extractMeetingUrl(haystack);
  if (!meetingUrl) return null;

  const received = internalDate ? new Date(Number(internalDate)) : new Date();
  const schedule = extractSchedule(body, received.getFullYear());

  return {
    title: cleanTitle(headers.subject) || "Meeting from Gmail",
    description: "",
    meetingUrl,
    startTime: schedule?.startTime ?? received,
    endTime: schedule?.endTime ?? null,
    participants: extractParticipants(headers, body),
    source: "GMAIL",
    sourceMessageId: messageId,
    externalId: meetingUrl
  };
}
