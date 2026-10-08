# MeetAI – Local-First AI Meeting & Productivity Assistant

MeetAI runs on your own computer. It keeps meetings in a local MongoDB, joins
Google Meet with your own signed-in browser profile, records the meeting to an
MP4 file with FFmpeg, and transcribes it locally with Whisper. Ollama (llama3)
then summarises the meeting, extracts decisions and action items, and indexes
everything so you can **ask questions about past meetings** (RAG with
`embeddinggemma`).

* **Free and local by default.** Nothing needs a paid service. Gemini (two free-tier keys),
  email, Notion and Gmail are optional extras.
* **Private by default.** The API listens on `127.0.0.1` only. Transcripts go to
  the cloud only if Ollama fails *and* you added Gemini keys. RAG answers never
  go to the cloud unless you set `RAG_ALLOW_CLOUD=true`.
* **No passwords.** MeetAI never asks for, stores or types your Google password.

```
User ─► React + Vite (127.0.0.1:5173) ─► Express API (127.0.0.1:5000)
                                              │
     ┌──────────────┬──────────────┬──────────┼───────────┬─────────────┬──────────────┐
     ▼              ▼              ▼          ▼           ▼             ▼              ▼
 Meeting svc   Recording svc  Transcription  AI Service   RAG svc     Email svc    Notion svc
 (Playwright)  (FFmpeg)       (faster-whisper) Manager   (chunk+embed) (SMTP)      (optional)
                                              │            │
                               Ollama ─► Gemini key 1 ─► Gemini key 2
                                                           │
                                         embeddinggemma ─► ChromaDB or MongoDB vectors
                         MongoDB (metadata)  +  recordings/ transcripts/ meeting-notes/ logs/
```

---

## 1. Prerequisites (Windows 10/11)

| Requirement | Why | Required? | Install (PowerShell) |
| --- | --- | --- | --- |
| Node.js 20.11+ (22/24 LTS fine) | API + dashboard | **yes** | `winget install OpenJS.NodeJS.LTS` |
| MongoDB Community 7+ | meetings, tasks, activity, vectors | **yes** | `winget install MongoDB.Server` (or Docker, §2.3) |
| Ollama | local LLM + embeddings | **yes** for AI | `winget install Ollama.Ollama` |
| FFmpeg | recording + audio extraction | for recording/transcription | `winget install Gyan.FFmpeg` |
| Python 3.10+ | runs faster-whisper | for transcription | `winget install Python.Python.3.12` |
| faster-whisper | speech to text | for transcription | `pip install faster-whisper` |
| Google Chrome **or** Microsoft Edge | joining Google Meet | for auto-join | Edge is preinstalled on Windows |
| ChromaDB | external vector DB | optional | `pip install chromadb` |
| Gemini API keys (free tier) | cloud fallback | optional | https://aistudio.google.com/apikey |
| SMTP account (e.g. Gmail App Password) | email summaries | optional | see §6.3 |
| Notion integration | publish notes | optional | https://www.notion.so/my-integrations |

Hardware: 8 GB RAM is the practical minimum (llama3 8B Q4 needs about 5 GB). With 4–6 GB,
use a smaller model such as `llama3.2:3b` and set `OLLAMA_NUM_CTX=4096`.

Check what you already have:

```powershell
node -v; npm -v; ffmpeg -version | Select-Object -First 1; python --version; ollama --version
```

---

## 2. Installation

### 2.1 Project dependencies

```powershell
cd "MeetAi-main"
npm install
```

### 2.2 Ollama models — choose local or cloud AI

```powershell
ollama pull llama3            # chat / analysis model (default)
ollama pull embeddinggemma    # embeddings for RAG search (required for RAG)
```

Optional extra local models you may already have: `codeAI`, `grammerAI`, or any Ollama tag.
Set `OLLAMA_CHAT_MODEL` to use one of them.

**Choosing where AI runs** (`.env` → `AI_PROVIDER`, or **Settings → AI provider**):

| Mode | Order tried | Use when |
| --- | --- | --- |
| `auto` (recommended) | Ollama → Gemini key 1 → Gemini key 2 | normal use; free + private, cloud only as backup |
| `ollama` | Ollama only | fully offline / maximum privacy |
| `gemini` | Gemini key 1 → Gemini key 2 → Ollama | low-RAM laptop that can't run llama3 well |

With no Gemini keys, `auto` behaves exactly like `ollama`.

### 2.3 MongoDB

Windows installs MongoDB as a service, so it is normally already running:

```powershell
mongosh --eval "db.runCommand({ ping: 1 })"
```

To use Docker instead:

```powershell
docker compose up -d mongo
```

### 2.4 FFmpeg

```powershell
winget install Gyan.FFmpeg
# open a NEW terminal so PATH updates, then:
ffmpeg -version
```

Leave `FFMPEG_PATH=ffmpeg` in `.env` unless FFmpeg is not on PATH.

### 2.5 Whisper (local transcription)

```powershell
pip install faster-whisper
python -c "import faster_whisper; print(faster_whisper.__version__)"
```

The first transcription downloads the model weights (~150 MB for `base`) once; after
that it works offline. Alternatives: `pip install openai-whisper`, or whisper.cpp
(set `WHISPER_CPP_BINARY` and `WHISPER_CPP_MODEL_PATH`).

### 2.6 ChromaDB (optional)

RAG works **without** ChromaDB: vectors are stored in MongoDB. To use Chroma instead:

```powershell
pip install chromadb
chroma run --path .\chroma-data --port 8000
```

Then set `CHROMA_URL=http://localhost:8000` and press **Ask meetings → Re-index all**.
If Chroma is down, MeetAI logs a warning and falls back to MongoDB automatically.

### 2.7 Configure

```powershell
Copy-Item .env.example .env
```

Every required value has a working local default. Open `.env` only to add the optional
integrations or pick your audio device (§5).

---

## 3. Run

```powershell
npm run dev
```

* Dashboard: http://localhost:5173
* API: http://127.0.0.1:5000/api/v1 (Swagger docs at http://127.0.0.1:5000/api-docs)

MongoDB and Ollama are separate long-running services: start them first.
If port 5000 is busy, `npm run dev` picks the next free port and points Vite at it.

Other commands:

```powershell
npm run check:local     # health of every local dependency (Mongo, Ollama, Whisper, FFmpeg, RAG, email...)
npm test                # 119 backend tests (auth, AI fallback, RAG, pipeline, security...)
npm run build           # type-check + production build of the dashboard
npm start               # serve API + built dashboard on one port
npm run connect:browser # open the MeetAI browser profile to sign in to Google once
```

To access the dashboard from another device on your network, set `AUTH_ENABLED=true` and
a `JWT_SECRET` first, then use `HOST=0.0.0.0` and `VITE_HOST=0.0.0.0`. Without auth, the
API has no login, which is why it binds to localhost by default.

---

## 4. First-time setup inside the app

1. Open http://localhost:5173 → the **Dashboard** status strip should show MongoDB,
   Ollama, Whisper, FFmpeg and RAG in green.
2. **Settings → Connect browser session**: a Chrome/Edge window opens with MeetAI's own
   profile. Sign in to Google there and close it. The session is reused for every join.
3. **Settings → Recording audio device**: press *Detect* and choose a device (see §5).
4. Optional: add Gemini keys, email, Notion and Gmail in `.env` and restart.

---

## 5. Recording audio on Windows

FFmpeg records the screen (`gdigrab`) plus **one** DirectShow audio device.

* To capture **what the meeting plays** (other people's voices), use a loopback device:
  enable **Stereo Mix** (Sound settings → Recording → right-click → *Show disabled
  devices*), or install the free **VB-Audio Virtual Cable**.
* A plain microphone only captures your room (your voice and speaker bleed).

```powershell
ffmpeg -hide_banner -list_devices true -f dshow -i dummy
```

Copy the exact name, e.g. `RECORDER_AUDIO_DEVICE=Stereo Mix (Realtek(R) Audio)`.
MeetAI checks the name against this list before recording, and it refuses to make a silent
recording unless you set `RECORDER_ALLOW_VIDEO_ONLY=true`.

---

## 6. Features

### 6.1 Meeting pipeline

```
Schedule/Gmail ─► scheduler (start − 2 min) ─► Playwright joins (Chrome → Edge → Chromium)
  ─► FFmpeg records ─► Stop/auto-detect end ─► audio.wav ─► faster-whisper ─► transcript.txt
  ─► AI Service Manager (Ollama → Gemini 1 → Gemini 2) ─► validated JSON
  ─► tasks + meeting-notes/<id>/summary.md ─► RAG index ─► Notion ─► email ─► dashboard
```

Each stage has a state (`PENDING · RUNNING · COMPLETED · FAILED · RETRYING · SKIPPED`)
and writes an **activity timeline** entry (Meeting → *Activity* tab; Dashboard →
*Pipeline activity*). Transient failures (timeouts, AI unavailable) are retried once.
A failed stage never deletes earlier artefacts. If AI analysis fails, the transcript is
still indexed for search, and **Process with AI** retries only what is missing.

### 6.2 AI analysis output

Title, short summary, detailed summary, key points, topics, decisions, action items (owner
and deadline when stated), deadlines, open questions, people responsible, follow-up
recommendations, sentiment, meeting outcome and priority. Output is extracted from the
model reply, validated with Joi and normalised. Invalid JSON is retried once with a
correction prompt. Long transcripts (more than `AI_ANALYSIS_CHUNK_CHARS`) are summarised in
parts and then merged, so nothing is silently cut off by the model's context window.

### 6.3 Email (optional, free)

Gmail SMTP with an **App Password** (free, about 500 emails/day):

1. Turn on 2-Step Verification for your Google account.
2. Create an app password at https://myaccount.google.com/apppasswords.
3. Add the following to `.env`:

```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=you@gmail.com
EMAIL_PASSWORD=<16-character app password>
EMAIL_FROM=MeetAI <you@gmail.com>
EMAIL_TO=you@gmail.com
```

Then use **Settings → Send test email**. With `EMAIL_TO` set, the summary is emailed after
every analysed meeting. Each meeting also has **Email summary**. Every attempt is stored in
the `EmailLog` collection. Without SMTP, emails are recorded as `SKIPPED` and nothing breaks.

### 6.4 Ask your meetings (RAG)

**Ask meetings** in the sidebar: e.g. *"What decisions were made in my previous meeting?"*,
*"What tasks were assigned to me?"*, *"Which meetings mentioned MongoDB?"*. Answers cite
their sources. You can also add your own documents, notes, preferences or profile
(paste text or load `.txt` / `.md`).

### 6.5 Gemini fallback & key rotation

```env
GEMINI_API_KEY_1=...
GEMINI_API_KEY_2=...
GEMINI_MODEL=gemini-flash-latest
```

The manager classifies every failure and acts on it as follows:

* `429` rate limit: that key cools down (Google's retry hint is used, otherwise 60 s).
* Quota exhausted: that key cools down for 1 hour.
* Invalid or revoked key: that key is disabled for the rest of the run and never hammered again.
* Timeout or 5xx: retried once on the same provider.
* Everything failed: a clean `503 AI_PROVIDER_UNAVAILABLE` error.

Keys are read only by the backend, sent only in a request header, and redacted from logs.
**Settings → Refresh status** shows each key's state. Free-tier limits vary per project:
see https://aistudio.google.com/rate-limit. Note that Google may use free-tier prompts to
improve its products, which is another reason MeetAI tries Ollama first.

---

## 7. Environment variables

Everything is documented in [`.env.example`](.env.example). Old names still work:
`OLLAMA_URL`, `OLLAMA_MODEL`, `GEMINI_API_KEY`, `SMTP_*`, `NOTION_TOKEN`,
`NOTION_MEETINGS_DATABASE_ID` and `JWT_ACCESS_SECRET` are accepted as aliases.

| Group | Variables |
| --- | --- |
| Core | `PORT`, `HOST`, `CLIENT_URL`, `MONGODB_URI` |
| AI | `AI_PROVIDER`, `AI_CLOUD_FALLBACK`, `AI_MAX_RETRIES`, `OLLAMA_BASE_URL`, `OLLAMA_CHAT_MODEL`, `OLLAMA_EMBEDDING_MODEL`, `OLLAMA_NUM_CTX`, `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, `GEMINI_MODEL` |
| RAG | `RAG_ENABLED`, `CHROMA_URL`, `RAG_CHUNK_SIZE`, `RAG_CHUNK_OVERLAP`, `RAG_TOP_K`, `RAG_ALLOW_CLOUD` |
| Media | `FFMPEG_PATH`, `FFPROBE_PATH`, `RECORDER`, `RECORDER_AUDIO_DEVICE`, `WHISPER_*` |
| Email | `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_FROM`, `EMAIL_TO` |
| Optional | `NOTION_API_KEY`, `NOTION_DATABASE_ID` (ID or full URL), `GOOGLE_CLIENT_ID/SECRET` |
| Auth | `AUTH_ENABLED`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `BCRYPT_SALT_ROUNDS` |

Never put a secret in a `VITE_*` variable, because those are compiled into the browser bundle.

---

## 8. Testing

```powershell
npm test
```

There are 119 tests in 9 files:

* **Auth:** register, login, JWT, refresh, logout revocation, role-escalation guard, per-user isolation.
* **AI manager:** fallback order, key rotation, invalid-key blacklist, cooldowns, retries, local-only mode.
* **Gemini and Ollama:** HTTP behaviour, with `fetch` mocked.
* **RAG:** chunking, ranking, owner isolation, delete, and a live ChromaDB test when a server is running.
* **Pipeline:** stages, timeline, retries, task de-duplication, email logging, escaped HTML.
* **Security:** invalid ids, regex/NoSQL injection, XSS, malformed JSON, Helmet headers, secrets never returned.
* **Existing suites:** meetings, tasks, settings, scheduler, Gmail parser, recorder arguments.

Database tests use throwaway databases (`meetai_test*`) on the local MongoDB and are
skipped when MongoDB is not running.

---

## 9. Troubleshooting

| Symptom | Fix |
| --- | --- |
| *Cannot reach the MeetAI API* | Run `npm run dev`; check `logs/error.log`. |
| *MongoDB is disconnected* | `net start MongoDB` (admin PowerShell) or `docker compose up -d mongo`. |
| *Ollama is not running* | Start the Ollama app, or run `ollama serve`. |
| *llama3 is not pulled* / RAG says embedding model missing | `ollama pull llama3` / `ollama pull embeddinggemma` |
| *AI service is currently unavailable* | Ollama is down and there are no usable Gemini keys. Check **Settings** for per-key state. |
| *FFmpeg was not found* | `winget install Gyan.FFmpeg`, open a new terminal, or set `FFMPEG_PATH` to `ffmpeg.exe`. |
| *Audio device "…" was not found* | The name is from another PC or has a typo. Pick one of the listed devices in Settings. |
| *No browser could be launched* | Install Chrome or Edge, or run `npx playwright install chromium`. Close other MeetAI browser windows (the profile is locked while open). |
| *Could not find a Join button* | Run **Connect browser session** to sign in, or the link has expired. |
| Transcription is slow | Use `WHISPER_MODEL=base` or `tiny`. `WHISPER_DEVICE=cuda` needs CUDA + cuBLAS (falls back to CPU). |
| Email `FAILED: 535` | Use a Gmail **App Password**, not your normal password. |
| Gemini `MODEL_NOT_FOUND` | Set `GEMINI_MODEL=gemini-flash-latest` (`gemini-2.0-flash` has been shut down). |

Logs: `logs/meetai.log` (everything), `logs/error.log`, `logs/ai.log` (provider
selection, fallbacks, retries), `logs/meeting.log` (pipeline timeline). Keys, tokens and
passwords are redacted.

---

## 10. Security

* The servers bind to `127.0.0.1` by default; set `AUTH_ENABLED=true` before exposing them.
* JWT access (15 min) and refresh (7 days) tokens. Refresh tokens are bcrypt-hashed and revoked on logout.
* bcrypt password hashing. Self-registration can never create an `ADMIN`.
* Joi validation on every write; ObjectId guard on every `:id` route.
* Helmet, CORS limited to the dashboard origin, HPP, Mongo operator sanitising, and rate limiting
  (global, plus 20 attempts per 15 minutes on auth).
* One error format: `{ success:false, error:{ code, message } }`, with no stack traces in responses.
* File streaming only serves paths inside the managed folders. Subprocesses are spawned with
  argument arrays (no shell), so there is no command injection.
* `.env`, `.secrets/`, `browser-profile/`, `recordings/`, `transcripts/`, `meeting-notes/` and `logs/` are git-ignored.

See `docs/ISSUES.md` for the full audit, and `docs/` for architecture, API and database documentation.
