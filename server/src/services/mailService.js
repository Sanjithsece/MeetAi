import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { EmailLog } from "../models/EmailLog.js";
import { logger } from "../utils/logger.js";

/**
 * EmailService - optional, free-first notifications over plain SMTP
 * (Gmail + App Password, Outlook, Brevo free tier, a local Mailpit...).
 *
 * - When SMTP is not configured every send is a logged no-op ("SKIPPED"),
 *   so MeetAI keeps working without email.
 * - SMTP credentials are only read from .env and never logged or returned.
 */

let transporterOverride = null;
let cachedTransporter = null;

/** Tests inject a nodemailer transport (e.g. { jsonTransport: true }). */
export function setTransportForTesting(transport) {
  transporterOverride = transport ? nodemailer.createTransport(transport) : null;
  cachedTransporter = null;
}

export function isEmailConfigured() {
  return Boolean(transporterOverride || (env.email.host && env.email.user && env.email.password));
}

function transporter() {
  if (transporterOverride) return transporterOverride;
  if (!isEmailConfigured()) return null;
  cachedTransporter ??= nodemailer.createTransport({
    host: env.email.host,
    port: env.email.port,
    secure: env.email.secure,
    auth: { user: env.email.user, pass: env.email.password },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000
  });
  return cachedTransporter;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

const list = (items) => (items?.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p><em>None recorded.</em></p>");

/** Low-level send with logging. Returns { status, messageId?, error? } and never throws. */
export async function sendMail({ to, subject, html, text, kind = "NOTIFICATION", owner, meeting, attachments }) {
  const recipient = String(to ?? "").trim();
  const record = async (status, extra = {}) => {
    await EmailLog.create({ owner, meeting, kind, to: recipient || "(none)", subject, status, ...extra }).catch(() => undefined);
    return { status, ...extra };
  };

  const transport = transporter();
  if (!transport) {
    logger.info("Email skipped because SMTP is not configured", { kind, subject });
    return record("SKIPPED", { error: "SMTP is not configured" });
  }
  if (!recipient) return record("SKIPPED", { error: "No recipient" });

  try {
    const info = await transport.sendMail({ from: env.email.from, to: recipient, subject, html, text, attachments });
    logger.info("Email sent", { kind, subject, messageId: info.messageId });
    return record("SENT", { messageId: info.messageId });
  } catch (error) {
    // Nodemailer errors can echo the SMTP response but never the password.
    logger.warn("Email failed", { kind, subject, error: error.message });
    return record("FAILED", { error: error.message.slice(0, 300) });
  }
}

function meetingHeader(meeting) {
  const when = meeting.startTime ? new Date(meeting.startTime).toLocaleString() : "unknown time";
  return `<h2 style="margin:0">${escapeHtml(meeting.aiAnalysis?.title || meeting.title)}</h2><p style="color:#555;margin-top:4px">${escapeHtml(when)}</p>`;
}

export function renderSummaryHtml(meeting) {
  const ai = meeting.aiAnalysis ?? {};
  const actions = (ai.actionItems ?? []).map(
    (item) => `${item.task}${item.person ? ` — ${item.person}` : ""}${item.deadline ? ` (due ${item.deadline})` : ""}`
  );
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:680px">
${meetingHeader(meeting)}
<h3>Summary</h3><p>${escapeHtml(ai.summary || ai.shortSummary || "No summary available.")}</p>
<h3>Key points</h3>${list(ai.keyPoints)}
<h3>Decisions</h3>${list(ai.decisions)}
<h3>Action items</h3>${list(actions)}
<h3>Open questions</h3>${list(ai.questions)}
<h3>Recommended follow-ups</h3>${list(ai.followUps)}
<p style="color:#888;font-size:12px">Generated locally by MeetAI (${escapeHtml(ai.provider ?? "local")} ${escapeHtml(ai.model ?? "")}).</p>
</div>`;
}

export function sendMeetingSummary({ meeting, to, transcriptText }) {
  const attachments = transcriptText ? [{ filename: "transcript.txt", content: transcriptText }] : undefined;
  return sendMail({
    to,
    owner: meeting.owner,
    meeting: meeting._id,
    kind: "MEETING_SUMMARY",
    subject: `Meeting summary: ${meeting.aiAnalysis?.title || meeting.title}`,
    html: renderSummaryHtml(meeting),
    attachments
  });
}

export function sendTranscript({ meeting, to, transcriptText }) {
  return sendMail({
    to,
    owner: meeting.owner,
    meeting: meeting._id,
    kind: "TRANSCRIPT",
    subject: `Transcript: ${meeting.title}`,
    html: `${meetingHeader(meeting)}<p>The transcript is attached.</p>`,
    attachments: [{ filename: "transcript.txt", content: transcriptText ?? "" }]
  });
}

export function sendActionItems({ meeting, to }) {
  const items = (meeting.aiAnalysis?.actionItems ?? []).map(
    (item) => `${item.task}${item.person ? ` — ${item.person}` : ""}${item.deadline ? ` (due ${item.deadline})` : ""} [${item.priority}]`
  );
  return sendMail({
    to,
    owner: meeting.owner,
    meeting: meeting._id,
    kind: "ACTION_ITEMS",
    subject: `Action items: ${meeting.title}`,
    html: `${meetingHeader(meeting)}<h3>Action items</h3>${list(items)}`
  });
}

export function sendNotification({ to, subject, message, owner, meeting }) {
  return sendMail({ to, owner, meeting, kind: "NOTIFICATION", subject, html: `<p>${escapeHtml(message)}</p>`, text: message });
}

/** Digest of the last 24h of completed meetings. */
export function sendDailyDigest({ to, owner, meetings }) {
  const rows = meetings.map((meeting) => `${meeting.title}: ${meeting.aiAnalysis?.shortSummary || meeting.aiAnalysis?.summary || meeting.status}`);
  return sendMail({ to, owner, kind: "DAILY_DIGEST", subject: `MeetAI daily digest (${meetings.length} meetings)`, html: `<h2>Your meetings today</h2>${list(rows)}` });
}

export async function emailStatus() {
  if (transporterOverride) return { configured: true, message: "Test transport active" };
  if (!isEmailConfigured()) {
    return { configured: false, message: "Email: not configured (EMAIL_HOST / EMAIL_USER / EMAIL_PASSWORD are empty)" };
  }
  try {
    await transporter().verify();
    return { configured: true, connected: true, host: env.email.host, defaultRecipient: Boolean(env.email.to), message: `SMTP ready on ${env.email.host}:${env.email.port}` };
  } catch (error) {
    return { configured: true, connected: false, host: env.email.host, message: `SMTP check failed: ${error.message}` };
  }
}
