import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

/**
 * Optional Notion integration. When NOTION_TOKEN / NOTION_MEETINGS_DATABASE_ID
 * are empty every function here reports "not configured" and the pipeline
 * carries on - a meeting is never marked failed because Notion is missing.
 */

const NOTION_VERSION = "2022-06-28";
const API = "https://api.notion.com/v1";

export function isNotionConfigured() {
  return Boolean(env.notion.token && env.notion.databaseId);
}

async function notionRequest(path, { method = "GET", body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.notion.token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json"
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Notion API ${method} ${path} failed (${response.status}): ${payload.message ?? "unknown error"}`);
  }
  return payload;
}

export async function notionStatus() {
  if (!isNotionConfigured()) {
    return { configured: false, connected: false, message: "Notion: Not configured" };
  }
  try {
    const database = await notionRequest(`/databases/${env.notion.databaseId}`);
    const title = database.title?.map((part) => part.plain_text).join("") || "Meetings";
    return { configured: true, connected: true, database: title, message: `Connected to Notion database "${title}"` };
  } catch (error) {
    return { configured: true, connected: false, message: error.message };
  }
}

function text(content) {
  return [{ type: "text", text: { content: String(content ?? "").slice(0, 1900) } }];
}

function paragraph(content) {
  return { object: "block", type: "paragraph", paragraph: { rich_text: text(content) } };
}

function heading(content) {
  return { object: "block", type: "heading_2", heading_2: { rich_text: text(content) } };
}

function bullet(content) {
  return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: text(content) } };
}

function section(title, items) {
  if (!items.length) return [heading(title), paragraph("None recorded.")];
  return [heading(title), ...items.map(bullet)];
}

function buildBlocks(meeting) {
  const ai = meeting.aiAnalysis ?? {};
  const participants = (meeting.participants ?? [])
    .map((participant) => participant.name || participant.email)
    .filter(Boolean)
    .join(", ");

  const actionItems = (ai.actionItems ?? []).map((item) => {
    const owner = item.person ? ` - ${item.person}` : "";
    const due = item.deadline ? ` (due ${item.deadline})` : "";
    return `${item.task}${owner}${due} [${item.priority ?? "MEDIUM"}]`;
  });

  const deadlines = (ai.deadlines ?? []).map((item) =>
    [item.label, item.date, item.person].filter(Boolean).join(" - ")
  );

  return [
    paragraph(`Date: ${meeting.startTime ? new Date(meeting.startTime).toLocaleString() : "unknown"}`),
    paragraph(`Participants: ${participants || "not recorded"}`),
    ...(meeting.meetingUrl ? [paragraph(`Meeting URL: ${meeting.meetingUrl}`)] : []),
    heading("Summary"),
    paragraph(ai.summary || "No summary available."),
    ...section("Important Topics", ai.importantTopics ?? []),
    ...section("Decisions", ai.decisions ?? []),
    ...section("Action Items", actionItems),
    ...section("Deadlines", deadlines),
    heading("Transcript"),
    paragraph(
      meeting.transcript?.filePath
        ? `Stored locally at ${meeting.transcript.filePath}`
        : "No transcript stored for this meeting."
    )
  ];
}

/**
 * Notion databases vary wildly, so only the title property (whatever it is
 * called) is filled in. Everything else lives in the page body.
 */
async function resolveTitleProperty() {
  const database = await notionRequest(`/databases/${env.notion.databaseId}`);
  const entry = Object.entries(database.properties ?? {}).find(([, value]) => value.type === "title");
  return entry?.[0] ?? "Name";
}

export async function createMeetingPage(meeting) {
  if (!isNotionConfigured()) {
    return { skipped: true, reason: "Notion is not configured" };
  }

  const titleProperty = await resolveTitleProperty();
  const page = await notionRequest("/pages", {
    method: "POST",
    body: {
      parent: { database_id: env.notion.databaseId },
      properties: { [titleProperty]: { title: text(meeting.title) } },
      children: buildBlocks(meeting)
    }
  });

  logger.info("Notion page created", { meetingId: String(meeting._id), pageId: page.id });
  return { skipped: false, pageId: page.id, pageUrl: page.url, createdAt: new Date() };
}
