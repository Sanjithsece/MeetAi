# Architecture

MeetAI is a single-user desktop application. Every component runs on the user's
own machine; the only outbound traffic comes from the optional integrations
(Gmail, Notion, Gemini) and from Google Meet itself.

## Processes

| Process | Started by | Responsibility |
| --- | --- | --- |
| Express API (`server/src/index.js`) | `npm run dev:server` | REST API, file streaming, scheduler, background job queue |
| Vite dev server | `npm run dev:client` | React dashboard on port 5173, proxies `/api` to 5000 |
| `mongod` | the user / Docker | metadata store |
| `ollama serve` | the user | local LLM |
| Chromium (Playwright) | the API, on demand | joins Google Meet with the persistent profile |
| `ffmpeg` | the API, on demand | screen + audio capture, audio extraction, duration probing |
| Whisper (Python or whisper.cpp) | the API, on demand | speech to text |

Playwright and FFmpeg are deliberately separate: the browser automation drives
the meeting UI, the recorder captures the screen and a system-audio device.
Neither one pretends to do the other's job.

## Request path

```
React (TanStack Query)
   -> axios /api/v1/...
      -> Express router
         -> validate (Joi)
            -> controller
               -> service (ai | transcription | recording | automation | gmail | notion)
                  -> MongoDB (metadata)  +  local filesystem (media)
```

Long-running work never blocks a request. `POST /meetings/:id/process` creates a
`ProcessingJob`, returns `202`, and a serial in-process queue runs the steps.
The dashboard polls `GET /meetings/:id` while the job is `QUEUED`/`RUNNING`.

## Meeting lifecycle

```
UPCOMING ──start──> JOINING ──recorder ok──> RECORDING ──stop/auto-end──> RECORDING_COMPLETED
   │                   │                        │                              │
   │                   └── join fails ─> FAILED └── recorder fails ─> RECORDING_FAILED
   │                                                                           │
   └───────────────────────────────────────────────── process ────────────────┘
                                                                               │
                                     TRANSCRIBING ──> ANALYZING ──> COMPLETED  │
                                          │               │                    │
                                          └── FAILED ─────┘                    │
```

Failures are isolated on purpose: a failed analysis never deletes the recording
or the transcript, so **Process with AI** can simply be retried.

## Storage split

* **MongoDB** — meetings, tasks, processing jobs, settings, the single local
  user. Only *paths* to media, never the media itself.
* **Filesystem** — `recordings/`, `transcripts/`, `meeting-notes/`,
  `browser-profile/`, `logs/`, `.secrets/`.

`server/src/config/paths.js` is the single place that resolves these directories
and the only place allowed to decide whether a stored path may be served.

## Modules

```
services/
  ai/            index.js (provider selection + retry/repair)
                 ollamaProvider.js  geminiProvider.js  prompt.js  validation.js
  transcription/ whisper.js  faster_whisper_runner.py
  media/         ffmpeg.js
  recording/     recorder.js  recorders/index.js (per-OS argument builders)
  automation/    meetBot.js  (persistent Chromium profile)
  gmail/         oauthClient.js  gmailService.js  meetingParser.js
  notion/        notionService.js
  pipeline/      meetingPipeline.js  jobQueue.js
  scheduler/     meetingScheduler.js
  status/        systemStatus.js
  settingsService.js  localUserService.js
```

No single file owns the whole lifecycle; `meetingPipeline.js` composes the
others and is the only module that mutates meeting status.
