import Joi from "joi";
import { MEETING_SOURCES, MEETING_STATUSES, PRIORITIES } from "../models/Meeting.js";

const objectId = Joi.string().hex().length(24);

export const authSchemas = {
  register: Joi.object({
    name: Joi.string().min(2).max(120).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(8).max(128).required(),
    // No `role` here: self-registration must never be able to create an ADMIN.
    workspaceName: Joi.string().max(120),
    timezone: Joi.string().max(80)
  }),
  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),
  refresh: Joi.object({
    refreshToken: Joi.string().required()
  })
};

const participant = Joi.object({
  name: Joi.string().allow("").max(120),
  email: Joi.string().email().allow(""),
  role: Joi.string().valid("ORGANIZER", "ATTENDEE").default("ATTENDEE")
});

/**
 * `scheduledStart` / `durationMinutes` are accepted as aliases so the optional
 * n8n workflows shipped in `n8n-workflows/` keep working unchanged.
 */
export const meetingCreateSchema = Joi.object({
  title: Joi.string().min(2).max(180).required(),
  description: Joi.string().allow("").max(5000).default(""),
  meetingUrl: Joi.string().uri().allow("").default(""),
  startTime: Joi.date(),
  scheduledStart: Joi.date(),
  endTime: Joi.date().greater(Joi.ref("startTime")),
  durationMinutes: Joi.number().integer().min(1).max(1440),
  participants: Joi.array().items(participant).default([]),
  source: Joi.string().valid(...MEETING_SOURCES).default("MANUAL"),
  status: Joi.string().valid(...MEETING_STATUSES),
  priority: Joi.string().valid(...PRIORITIES).default("MEDIUM"),
  tags: Joi.array().items(Joi.string().max(40)).default([]),
  notes: Joi.string().allow("").max(20000).default(""),
  externalId: Joi.string().max(200),
  sourceMessageId: Joi.string().max(200),
  automation: Joi.object({
    autoJoin: Joi.boolean(),
    autoRecord: Joi.boolean(),
    autoProcess: Joi.boolean()
  })
})
  .or("startTime", "scheduledStart")
  .custom((value) => {
    const normalized = { ...value };
    normalized.startTime = value.startTime ?? value.scheduledStart;
    delete normalized.scheduledStart;
    if (!normalized.endTime && value.durationMinutes) {
      normalized.endTime = new Date(new Date(normalized.startTime).getTime() + value.durationMinutes * 60000);
    }
    delete normalized.durationMinutes;
    return normalized;
  });

export const meetingUpdateSchema = Joi.object({
  title: Joi.string().min(2).max(180),
  description: Joi.string().allow("").max(5000),
  meetingUrl: Joi.string().uri().allow(""),
  startTime: Joi.date(),
  endTime: Joi.date(),
  participants: Joi.array().items(participant),
  source: Joi.string().valid(...MEETING_SOURCES),
  status: Joi.string().valid(...MEETING_STATUSES),
  priority: Joi.string().valid(...PRIORITIES),
  tags: Joi.array().items(Joi.string().max(40)),
  notes: Joi.string().allow("").max(20000),
  automation: Joi.object({
    autoJoin: Joi.boolean(),
    autoRecord: Joi.boolean(),
    autoProcess: Joi.boolean()
  })
}).min(1);

export const taskCreateSchema = Joi.object({
  meeting: objectId,
  title: Joi.string().min(2).max(240).required(),
  description: Joi.string().allow("").max(3000),
  assigneeName: Joi.string().allow("").max(120),
  assigneeEmail: Joi.string().email().allow(""),
  deadline: Joi.date().allow(null),
  reminderAt: Joi.date().allow(null),
  priority: Joi.string().valid(...PRIORITIES).default("MEDIUM"),
  status: Joi.string().valid("PENDING", "IN_PROGRESS", "COMPLETED").default("PENDING"),
  aiGenerated: Joi.boolean().default(false)
});

export const taskUpdateSchema = Joi.object({
  title: Joi.string().min(2).max(240),
  description: Joi.string().allow("").max(3000),
  assigneeName: Joi.string().allow("").max(120),
  assigneeEmail: Joi.string().email().allow(""),
  deadline: Joi.date().allow(null),
  reminderAt: Joi.date().allow(null),
  priority: Joi.string().valid(...PRIORITIES),
  status: Joi.string().valid("PENDING", "IN_PROGRESS", "COMPLETED")
}).min(1);

export const settingsUpdateSchema = Joi.object({
  aiProvider: Joi.string().valid("auto", "ollama", "gemini").allow(null),
  ollamaUrl: Joi.string().uri().allow(null, ""),
  ollamaModel: Joi.string().max(120).allow(null, ""),
  whisperImplementation: Joi.string().valid("auto", "faster-whisper", "openai-whisper", "whisper-cpp").allow(null),
  whisperModel: Joi.string().max(60).allow(null, ""),
  whisperLanguage: Joi.string().max(20).allow(null, ""),
  joinOffsetMinutes: Joi.number().integer().min(0).max(60).allow(null),
  schedulerEnabled: Joi.boolean().allow(null),
  autoProcessAfterRecording: Joi.boolean(),
  createTasksFromActionItems: Joi.boolean(),
  recorderAudioDevice: Joi.string().max(200).allow(null, ""),
  meetingDisplayName: Joi.string().trim().max(60).allow(null, "")
}).min(1);

export const processRequestSchema = Joi.object({
  steps: Joi.array().items(Joi.string().valid("transcribe", "analyze", "rag", "notion", "email")).min(1),
  force: Joi.boolean().default(false)
});

/** Shape the AI provider must return before anything is written to MongoDB. */
export const aiAnalysisSchema = Joi.object({
  title: Joi.string().allow("", null).default(""),
  shortSummary: Joi.string().allow("", null).default(""),
  summary: Joi.string().allow("").required(),
  keyPoints: Joi.array().items(Joi.string().allow("")).default([]),
  questions: Joi.array().items(Joi.string().allow("")).default([]),
  followUps: Joi.array().items(Joi.string().allow("")).default([]),
  meetingStatus: Joi.string().allow("", null).default(""),
  importantTopics: Joi.array().items(Joi.string().allow("")).default([]),
  decisions: Joi.array().items(Joi.string().allow("")).default([]),
  actionItems: Joi.array()
    .items(
      Joi.object({
        task: Joi.string().allow("").required(),
        person: Joi.string().allow("", null).default(""),
        deadline: Joi.string().allow("", null).default(""),
        // Cosmetic enum: local models often send "" or "urgent". Normalised to
        // MEDIUM later instead of throwing away a whole valid analysis.
        priority: Joi.string().lowercase().allow("", null).default("medium")
      }).unknown(true)
    )
    .default([]),
  deadlines: Joi.array()
    .items(
      Joi.alternatives().try(
        Joi.string().allow(""),
        Joi.object({
          label: Joi.string().allow("", null).default(""),
          date: Joi.string().allow("", null).default(""),
          person: Joi.string().allow("", null).default("")
        })
      )
    )
    .default([]),
  peopleResponsible: Joi.array().items(Joi.string().allow("")).default([]),
  sentiment: Joi.string().lowercase().allow("", null).default("neutral"),
  priority: Joi.string().lowercase().allow("", null).default("medium")
}).unknown(true);

export const ragSearchSchema = Joi.object({
  query: Joi.string().trim().min(2).max(1000).required(),
  k: Joi.number().integer().min(1).max(20),
  meetingId: objectId
});

export const ragAskSchema = Joi.object({
  question: Joi.string().trim().min(3).max(1000).required(),
  k: Joi.number().integer().min(1).max(20),
  meetingId: objectId
});

export const ragDocumentSchema = Joi.object({
  title: Joi.string().trim().min(1).max(200).required(),
  // Plain text only (the UI reads .txt/.md files in the browser) - no binary uploads.
  text: Joi.string().min(1).max(200_000).required(),
  type: Joi.string().valid("document", "note", "preference", "profile").default("document")
});

export const meetingEmailSchema = Joi.object({
  kind: Joi.string().valid("summary", "transcript", "actions").default("summary"),
  to: Joi.string().email().allow("")
});

export const testEmailSchema = Joi.object({
  to: Joi.string().email().allow("")
});

/** Validates `:id` route params so a malformed id is a clean 400, not a database error. */
export const idParamSchema = Joi.object({ id: objectId.required() }).unknown(true);
