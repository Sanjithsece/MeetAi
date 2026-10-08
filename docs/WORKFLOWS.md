# Workflows

Everything below is orchestrated by Node.js. n8n is optional and is not part of
any of these paths.

## 1. Manual meeting

```
Add meeting form -> POST /meetings -> MongoDB -> dashboard + meetings list
```

Works with no internet and with every integration disabled.

## 2. Gmail detection (optional)

```
scheduler tick (GMAIL_SYNC_INTERVAL_MINUTES)
  -> refresh access token from .secrets/gmail-token.json
  -> Gmail search: newer_than:<lookback>d AND (meet.google.com OR zoom.us/j OR teams ... )
  -> decode the MIME body in memory
  -> meetingParser: title, url, date, time, participants
  -> dedupe on sourceMessageId, then on meetingUrl + start time within 1h
  -> create or enrich the meeting
```

Only the extracted fields are stored. Email bodies are never persisted.

## 3. Auto-join

```
scheduler tick (every MEETING_SCHEDULER_INTERVAL_SECONDS)
  -> meetings with status UPCOMING, automation.autoJoin, a meetingUrl,
     and startTime <= now + MEETING_JOIN_OFFSET_MINUTES (and not older than 15 min)
  -> meetingPipeline.startMeeting
       -> Playwright launchPersistentContext(BROWSER_PROFILE_DIR)
       -> open the meeting URL, mute mic + camera, click Join now / Ask to join
       -> status JOINING -> RECORDING
       -> FFmpeg starts recordings/<id>/meeting.mp4
       -> a watcher polls every 20s for the end of the call
```

A meeting is attempted once per server run.

## 4. Recording

```
FFmpeg (separate process)
  Windows: gdigrab desktop + dshow audio=<RECORDER_AUDIO_DEVICE>
  Linux:   x11grab $DISPLAY + pulse
  macOS:   avfoundation 1:<audio index>
       -> libx264 + aac, +faststart -> recordings/<id>/meeting.mp4

stop: write "q" to stdin so the MP4 container is finalised
      -> ffprobe duration, file size -> meeting.recording
      -> status RECORDING_COMPLETED
```

If no audio device is configured the recorder refuses to start and the meeting
goes to `RECORDING_FAILED` with an actionable message, unless
`RECORDER_ALLOW_VIDEO_ONLY=true`.

## 5. Transcription

```
meeting.mp4 -> ffmpeg -vn -ac 1 -ar 16000 -c:a pcm_s16le -> audio.wav
            -> faster-whisper | openai-whisper | whisper.cpp
            -> transcripts/<id>/transcript.txt
            -> audio.wav deleted (the MP4 and the transcript are kept)
```

## 6. AI analysis

```
transcript.txt -> Ollama /api/generate (format: json, temperature 0.2)
               -> extract JSON from the reply
               -> validate with Joi, normalise enums
               -> on failure: one correction prompt, then fail loudly
               -> meeting.aiAnalysis + meeting-notes/<id>/summary.md
               -> tasks created from action items (deduped)
```

## 7. Notion (optional)

```
aiAnalysis COMPLETED and NOTION_TOKEN + NOTION_MEETINGS_DATABASE_ID present
  -> POST /v1/pages with title, date, participants, summary, topics,
     decisions, action items, deadlines, transcript reference
  -> meeting.notion.pageId / pageUrl
```

A Notion failure is recorded on the meeting and never fails the pipeline.

## 8. Shutdown

`SIGINT` / `SIGTERM` stops the scheduler, finalises any in-flight MP4 and closes
the browser sessions before the process exits.
