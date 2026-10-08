# MeetAI — Local-First Migration Plan

Baseline inspected on 2026-08-19. This document records what existed, what is
reused, what is replaced and what is removed. Implementation follows the phase
order at the bottom.

## 1. Baseline inventory

### Frontend (`src/`)
| Item | Verdict |
| --- | --- |
| `main.tsx`, `router/AppRouter.tsx`, `ProtectedRoute.tsx` | reuse, re-route |
| `layouts/AppLayout.tsx`, `PublicLayout.tsx` | reuse |
| `components/navigation/{Sidebar,Topbar,PublicNavbar}.tsx` | reuse, re-label nav |
| `components/ui/{Button,Card,Modal,Toast,StatCard,DataTable,SearchFilters,ProgressBar}.tsx` | reuse |
| `components/ui/{BadgeCard,UploadDropzone}.tsx` | remove (leftover from an unrelated app) |
| `context/{Auth,Theme}Context.tsx` | reuse; Auth switches to local single-user bootstrap |
| `services/api/{client,meetaiApi}.ts`, `services/queries.ts` | rewrite around the new API surface |
| `pages/app/{Dashboard,Meetings,MeetingDetails,TaskManager,Analytics,Settings,Notifications,Profile,Calendar,Transcript,Search}.tsx` | rewrite/keep |
| `pages/app/{Activities,AdminManagement,Badges,Events,Leaderboard,Reports}.tsx` | remove — dead files from the `ai365-cce` project, not routed |
| `pages/auth/*`, `pages/public/*` | keep (only used when `AUTH_ENABLED=true`) |

### Backend (`server/src/`)
| Item | Verdict |
| --- | --- |
| `app.js`, `index.js` | reuse, extend with static file streaming + workers |
| `config/env.js` | rewrite — local-first variables |
| `config/database.js` | reuse |
| `config/cloudinary.js`, `services/storageService.js`, `middlewares/upload.js` | remove — cloud storage is out of the architecture |
| `middlewares/{security,validate,errorHandler,auth}.js` | reuse; `auth` gains local single-user mode |
| `models/{User,Task,Notification}.js`, `models/plugins/baseSchema.js` | reuse |
| `models/Meeting.js` | refactor to the local-first schema (recording/transcript/aiAnalysis/notion sub-documents + processing status) |
| `models/Recording.js` | remove — superseded by `Meeting.recording` |
| `controllers/meetaiController.js` | split into per-resource controllers |
| `services/{authService,tokenService,mailService}.js` | keep (auth optional, mail already no-ops without SMTP) |
| `repositories/*` | keep |
| `validations/schemas.js` | trim to MeetAI schemas (drops certificate/badge/hackathon schemas from the old project) |
| `automation/playwright/joinMeeting.js` | replace — used a throwaway browser and wrote only metadata |
| `swagger.js` | rewrite for the real endpoints |
| `Dockerfile`, `docker-compose.yml` | remove deployment image; keep an optional MongoDB-only compose file |
| `n8n-workflows/` | keep as optional, no longer wired into the runtime |

## 2. Target module layout (backend)

```
server/src/
  config/        env.js  paths.js  database.js
  models/        Meeting.js  Task.js  User.js  Notification.js  Setting.js  ProcessingJob.js
  services/
    ai/          index.js  ollamaProvider.js  geminiProvider.js  prompt.js  validation.js
    media/       ffmpeg.js
    transcription/ whisper.js
    recording/   recorder.js
    automation/  meetBot.js
    gmail/       oauthClient.js  gmailService.js  meetingParser.js
    notion/      notionService.js
    pipeline/    meetingPipeline.js  jobQueue.js
    scheduler/   meetingScheduler.js
    status/      systemStatus.js
    settingsService.js
  controllers/   meetingController.js  taskController.js  analyticsController.js
                 integrationController.js  systemController.js  notificationController.js
  routes/        index.js  meetingRoutes.js  taskRoutes.js  integrationRoutes.js  systemRoutes.js
```

## 3. Phase order

1. Config, paths, env, `.gitignore`, dependency changes.
2. Models (`Meeting`, `Setting`, `ProcessingJob`), validation schemas.
3. Local single-user auth mode + controllers + routes (CRUD, recording streaming).
4. Playwright persistent-profile meet bot + manual join.
5. FFmpeg recorder service (modular, Windows-first).
6. Local Whisper transcription.
7. Ollama/Llama 3 analysis with JSON validation + repair, optional Gemini fallback.
8. Pipeline orchestrator, background job queue, task extraction.
9. Gmail OAuth + meeting detection.
10. Notion page creation (optional).
11. Scheduler.
12. Frontend rewrite.
13. Tests + docs.

---

## 4. Outcome (completed)

Implemented in the phase order above. Verified on this machine on 2026-08-19:

| Check | Result |
| --- | --- |
| MongoDB connection | connected (`mongodb://127.0.0.1:27017/meetai`) |
| Manual meeting create / list / detail / update / delete | working, from both the API and the dashboard form |
| FFmpeg recording | real 1920x1080 MP4 written to `recordings/<id>/meeting.mp4` (4.8 MB / 15 s) |
| MP4 playback | streams through `GET /meetings/:id/recording`; browser reported `readyState 4`, 1920x1080, 14.9 s. Range requests return 200 / 206 / 416 correctly |
| Audio extraction | `meeting.mp4 -> audio.wav` (16 kHz mono) via FFmpeg |
| Local transcription | faster-whisper produced `transcripts/<id>/transcript.txt` |
| Ollama + Llama 3 | pulled and answering; analysis produced validated JSON |
| AI analysis storage | summary, topics, decisions, action items, deadlines, people, sentiment, priority persisted |
| Task extraction | action items became `Task` documents with owner, deadline and priority |
| Background jobs | `202` + polling; failures recorded on the job, artefacts preserved |
| Notion / Gmail / Gemini absent | reported as "Not configured", pipeline still completed |
| Tests / lint / typecheck / build | 60 passing, clean, clean, clean |

Bugs found and fixed during verification:

1. Llama 3 wrote the literal string `"empty string"` into optional fields.
   The prompt now shows `""` explicitly and the validator strips placeholder
   values (`empty string`, `N/A`, `none`, `unknown`, ...).
2. faster-whisper failed on Windows with `WinError 1314` because
   huggingface_hub caches weights with symlinks. The child process is now run
   with `HF_HUB_DISABLE_SYMLINKS=1`.
3. faster-whisper defaulted to CUDA and crashed with
   `Library cublas64_12.dll is not found`. The runner now defaults to CPU
   (`WHISPER_DEVICE`) and falls back to CPU automatically if the GPU path fails.
4. `browserProfileStatus` reported a signed-out profile as signed in, because a
   signed-out account page redirects to a marketing URL. It now checks the
   Google session cookies instead of the URL.
5. `runAnalysis` left the meeting in `ANALYZING` when called outside the queued
   pipeline; it now closes the meeting itself.

All verification data (meetings, recordings, transcripts, notes, tasks, jobs)
was deleted afterwards.
