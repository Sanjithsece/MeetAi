# n8n workflows (optional)

MeetAI does **not** require n8n. The whole meeting lifecycle - detection,
joining, recording, transcription, AI analysis, task creation and Notion
publishing - is orchestrated by the Node.js backend in
`server/src/services/pipeline/meetingPipeline.js` and the scheduler in
`server/src/services/scheduler/meetingScheduler.js`.

These JSON files are kept for people who already run an n8n server and want to
trigger MeetAI from it. They post to the normal local API:

```
POST http://localhost:5000/api/v1/meetings
```

The meeting endpoint still accepts the legacy `scheduledStart` and
`durationMinutes` fields these workflows send, so they work unchanged.

Nothing here is started, required or health-checked by the application.
