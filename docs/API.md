# API

Base URL: `http://localhost:5000/api/v1` — interactive docs at
`http://localhost:5000/api-docs`.

Responses use `{ success, message, data, meta? }`. Errors use
`{ success: false, message, details? }`.

Authentication: none in the default single-user mode — the server resolves the
local workspace owner itself. With `AUTH_ENABLED=true`, send
`Authorization: Bearer <accessToken>`.

## Meetings

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/meetings` | `scope=today\|upcoming\|previous\|recorded`, `status`, `priority`, `source`, `search`, `from`, `to`, `sort=newest\|oldest\|title\|priority`, `page`, `limit`. Returns `meta` with pagination. |
| `POST` | `/meetings` | Manual creation. Also accepts the legacy `scheduledStart` + `durationMinutes` pair used by the n8n workflows. |
| `GET` | `/meetings/:id` | `{ meeting, tasks, job, live, files }` |
| `PATCH` | `/meetings/:id` | partial update |
| `DELETE` | `/meetings/:id` | soft delete |

### Files

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/meetings/:id/recording` | Streams the local MP4. Supports `Range`, replies `206` with `Content-Range`, `416` for a bad range. Only paths inside the managed directories are served. |
| `GET` | `/meetings/:id/transcript` | JSON `{ text, meta }`, or `?download=true` for a `.txt` attachment. |
| `GET` | `/meetings/:id/notes` | Markdown produced by the local model. |

### Automation

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/meetings/:id/start` | Joins with the persistent browser profile and starts the recorder. `{ record: false }` joins without recording. |
| `POST` | `/meetings/:id/stop` | Stops the recorder, leaves the call, queues processing when enabled. |
| `POST` | `/meetings/:id/process` | `{ steps?: ["transcribe","analyze","notion"], force?: boolean }`. Returns `202` with the job. |
| `GET` | `/meetings/:id/job` | Latest job for the meeting. |

## Tasks

`GET /tasks` (`status`, `meeting`, `overdue=true`), `POST /tasks`,
`PATCH /tasks/:id`, `DELETE /tasks/:id`.

## Analytics

`GET /analytics` → totals, recording/meeting hours, average duration, task
counts, six-month history, status breakdown.

## System

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/system/status` | MongoDB, Ollama, Gemini, Whisper, FFmpeg, recorder, Gmail, Notion, scheduler, queue depth, offline capability list. `?browser=true` also probes the Playwright profile (slow). |
| `GET` | `/system/settings` | Effective settings. Never contains a secret. |
| `PATCH` | `/system/settings` | Non-secret runtime settings only. |
| `GET` | `/system/audio-devices` | FFmpeg dshow capture devices (Windows). |

## Integrations

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/integrations/gmail/connect` | Returns the Google consent URL. |
| `GET` | `/integrations/gmail/callback` | OAuth redirect target (unauthenticated by design). |
| `GET` | `/integrations/gmail/status` | `configured` / `connected` / message. |
| `POST` | `/integrations/gmail/sync` | Scan now → `{ scanned, created, updated }`. |
| `DELETE` | `/integrations/gmail` | Deletes the local token. |
| `GET` | `/integrations/notion/status` | Reports "Not configured" rather than failing. |
| `POST` | `/integrations/browser/connect` | Opens the persistent profile for a one-time Google sign-in. |
| `GET` | `/integrations/browser/status` | Whether the profile has a Google session. |

## Auth (only with `AUTH_ENABLED=true`)

`POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`,
`POST /auth/logout`. `GET /auth/me` always works and returns the current owner.
