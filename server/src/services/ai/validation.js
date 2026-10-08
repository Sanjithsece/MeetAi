import { aiAnalysisSchema } from "../../validations/schemas.js";

const PRIORITY_MAP = { low: "LOW", medium: "MEDIUM", high: "HIGH", critical: "CRITICAL" };
const SENTIMENT_MAP = { positive: "POSITIVE", neutral: "NEUTRAL", negative: "NEGATIVE", mixed: "MIXED" };

/**
 * Local models sometimes echo the instruction instead of leaving a field blank,
 * writing "empty string" or "N/A" as the value. Those are not real content.
 */
const PLACEHOLDERS = new Set([
  "",
  "empty string",
  "empty",
  "n/a",
  "na",
  "none",
  "null",
  "unknown",
  "not stated",
  "not specified",
  "not mentioned",
  "no deadline",
  "tbd",
  "-"
]);

function firstSentence(text) {
  const match = text.match(/^.+?[.!?](?=\s|$)/);
  return (match ? match[0] : text).slice(0, 280);
}

function clean(value) {
  const text = String(value ?? "").trim();
  return PLACEHOLDERS.has(text.toLowerCase()) ? "" : text;
}

/**
 * Local models happily wrap JSON in prose or code fences. Pull the first
 * balanced JSON object out of the raw completion before parsing it.
 */
export function extractJson(raw) {
  if (typeof raw !== "string") return null;
  const withoutFences = raw.replace(/```(?:json)?/gi, "```").split("```").reduce((best, chunk) => {
    const trimmed = chunk.trim();
    return trimmed.startsWith("{") && trimmed.length > (best?.length ?? 0) ? trimmed : best;
  }, null);

  const candidates = [];
  if (withoutFences) candidates.push(withoutFences);

  const start = raw.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = !inString;
      } else if (!inString && char === "{") {
        depth += 1;
      } else if (!inString && char === "}") {
        depth -= 1;
        if (depth === 0) {
          candidates.push(raw.slice(start, index + 1));
          break;
        }
      }
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Accepts the loose shapes models produce and returns the storage shape. */
export function normalizeAnalysis(parsed) {
  const { error, value } = aiAnalysisSchema.validate(parsed, { abortEarly: false, convert: true });
  if (error) {
    return { ok: false, message: error.details.map((detail) => `${detail.path.join(".")}: ${detail.message}`).join("; ") };
  }

  const deadlines = value.deadlines.map((entry) =>
    typeof entry === "string"
      ? { label: clean(entry), date: "", person: "" }
      : { label: clean(entry.label), date: clean(entry.date), person: clean(entry.person) }
  );

  const list = (items) => items.map(clean).filter(Boolean);
  const meetingStatus = clean(value.meetingStatus).toLowerCase();

  return {
    ok: true,
    value: {
      title: clean(value.title).slice(0, 180),
      // Local models often leave this blank - fall back to the summary's first sentence.
      shortSummary: clean(value.shortSummary) || firstSentence(clean(value.summary)),
      summary: clean(value.summary),
      keyPoints: list(value.keyPoints),
      questions: list(value.questions),
      followUps: list(value.followUps),
      meetingStatus: ["productive", "blocked", "informational", "inconclusive"].includes(meetingStatus) ? meetingStatus : "",
      importantTopics: value.importantTopics.map(clean).filter(Boolean),
      decisions: value.decisions.map(clean).filter(Boolean),
      actionItems: value.actionItems
        .map((item) => ({
          task: clean(item.task),
          person: clean(item.person),
          deadline: clean(item.deadline),
          priority: PRIORITY_MAP[item.priority] ?? "MEDIUM"
        }))
        .filter((item) => item.task),
      deadlines: deadlines.filter((entry) => entry.label || entry.date),
      peopleResponsible: value.peopleResponsible.map(clean).filter(Boolean),
      sentiment: SENTIMENT_MAP[value.sentiment] ?? "NEUTRAL",
      priority: PRIORITY_MAP[value.priority] ?? "MEDIUM"
    }
  };
}

/** Parse + validate in one step. Returns `{ ok, value }` or `{ ok:false, message }`. */
export function parseAnalysis(raw) {
  const parsed = extractJson(raw);
  if (!parsed) return { ok: false, message: "No JSON object could be extracted from the model output" };
  return normalizeAnalysis(parsed);
}
