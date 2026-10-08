# Database design

Local MongoDB, default database `meetai`. Media files are **never** stored in
MongoDB — only their paths.

## `meetings`

| Field | Type | Notes |
| --- | --- | --- |
| `owner` | ObjectId → `users` | the local workspace owner |
| `title` | String | required |
| `description` | String | |
| `meetingUrl` | String | Google Meet / Zoom / Teams link |
| `date` | Date | derived from `startTime` (local midnight) |
| `startTime` / `endTime` | Date | `durationMinutes` is a virtual |
| `participants[]` | `{ name, email, role }` | |
| `source` | enum | `MANUAL` `GMAIL` `GOOGLE_CALENDAR` `IMPORT` |
| `status` | enum | see lifecycle below |
| `priority` | enum | `LOW` `MEDIUM` `HIGH` `CRITICAL` |
| `tags[]`, `notes` | | |
| `recording` | sub-doc | `filePath` `format` `durationSeconds` `sizeBytes` `recordedAt` `recorder` `error` |
| `transcript` | sub-doc | `filePath` `status` `engine` `language` `wordCount` `generatedAt` `error` |
| `aiAnalysis` | sub-doc | `status` `provider` `model` `summary` `importantTopics[]` `decisions[]` `actionItems[]` `deadlines[]` `peopleResponsible[]` `sentiment` `priority` `notesPath` `generatedAt` `error` |
| `notion` | sub-doc | `pageId` `pageUrl` `createdAt` `error` |
| `automation` | sub-doc | `autoJoin` `autoRecord` `autoProcess` `joinedAt` `leftAt` `lastError` |
| `externalId`, `sourceMessageId` | String | Gmail deduplication keys |
| `statusHistory[]` | `{ status, at, detail }` | last 50 transitions |
| `isDeleted` / `deletedAt` / `deletedBy` | | soft delete |

`status`: `UPCOMING` `JOINING` `RECORDING` `RECORDING_COMPLETED`
`RECORDING_FAILED` `TRANSCRIBING` `ANALYZING` `COMPLETED` `FAILED` `CANCELLED`.

`actionItems[]`: `{ task, person, deadline, priority }` — exactly the shape the
AI validator produces.

Indexes: `owner+startTime+status+isDeleted`, `startTime`, `status`, `priority`,
`source`, sparse `externalId` / `sourceMessageId`, and a text index on
`title`, `notes`, `aiAnalysis.summary`.

## `tasks`

`owner`, `meeting` (optional), `title`, `description`, `assigneeName`,
`assigneeEmail`, `deadline`, `reminderAt`, `priority`, `status`
(`PENDING` `IN_PROGRESS` `COMPLETED`), `aiGenerated`, `sourceActionItem`
(dedupe key `<meetingId>:<task text>`), `completedAt`, soft-delete fields.

## `processingjobs`

`meeting`, `type` (`FULL_PIPELINE` `TRANSCRIBE` `ANALYZE` `NOTION` `RECORD`),
`status` (`QUEUED` `RUNNING` `COMPLETED` `FAILED` `CANCELLED`), `step`,
`progress`, `error`, `startedAt`, `finishedAt`.

Durable on purpose: a job that was running when the server died is still visible
afterwards.

## `settings`

Single document (`key: "local"`). Holds only the non-secret values editable from
the Settings page — AI provider, Ollama URL/model, Whisper configuration, join
offset, scheduler toggle, audio device. `null` means "fall back to `.env`".
No API key, token or credential is ever written here.

## `users`

One document in the default single-user mode, created automatically from
`LOCAL_USER_NAME` / `LOCAL_USER_EMAIL` with an unusable random password hash.
The full account fields remain for `AUTH_ENABLED=true`.

## `notifications`

Retained from the previous version for in-app messages; not required by any part
of the local pipeline.
