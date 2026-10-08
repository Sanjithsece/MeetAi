import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { Meeting } from "../src/models/Meeting.js";
import { Task } from "../src/models/Task.js";
import { resetLocalUserCache } from "../src/services/localUserService.js";
import { findDueMeetings } from "../src/services/scheduler/meetingScheduler.js";

/**
 * Runs against a throwaway database on the local MongoDB the app already needs.
 * If mongod is not running the suite is skipped rather than failing the build.
 */
const TEST_URI = process.env.TEST_MONGODB_URI ?? "mongodb://127.0.0.1:27017/meetai_test";

// Connect at module scope: `describe.skip` is decided while tests are being
// collected, which happens before any beforeAll hook runs.
let mongoAvailable = false;
try {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 3000 });
  mongoAvailable = true;
} catch {
  mongoAvailable = false;
}

let app;

beforeAll(async () => {
  if (!mongoAvailable) return;
  await mongoose.connection.dropDatabase();
  resetLocalUserCache();
  app = createApp();
});

afterAll(async () => {
  if (mongoAvailable) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

const describeIfMongo = () => (mongoAvailable ? describe : describe.skip);

describe("MeetAI local API", () => {
  it("skips the database suite when MongoDB is unavailable", () => {
    if (!mongoAvailable) {
      console.warn(`MongoDB not reachable at ${TEST_URI} - database tests skipped`);
    }
    expect(true).toBe(true);
  });

  describeIfMongo()("meetings", () => {
    let meetingId;

    it("creates a meeting from the manual form payload", async () => {
      const response = await request(app)
        .post("/api/v1/meetings")
        .send({
          title: "Project Review",
          description: "Weekly review",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
          startTime: "2026-08-19T10:00:00.000Z",
          endTime: "2026-08-19T11:00:00.000Z",
          priority: "HIGH",
          participants: [{ name: "Sanjith", email: "sanjith@example.com", role: "ORGANIZER" }]
        })
        .expect(201);

      meetingId = response.body.data.id ?? response.body.data._id;
      expect(response.body.data.title).toBe("Project Review");
      expect(response.body.data.status).toBe("UPCOMING");
      expect(response.body.data.transcript.status).toBe("PENDING");
      expect(response.body.data.owner).toBeTruthy();
    });

    it("accepts the legacy scheduledStart / durationMinutes payload", async () => {
      const response = await request(app)
        .post("/api/v1/meetings")
        .send({ title: "Legacy workflow meeting", scheduledStart: "2026-08-20T09:00:00.000Z", durationMinutes: 30 })
        .expect(201);

      expect(new Date(response.body.data.endTime).toISOString()).toBe("2026-08-20T09:30:00.000Z");
    });

    it("rejects a meeting with no start time", async () => {
      const response = await request(app).post("/api/v1/meetings").send({ title: "No time" }).expect(422);
      expect(response.body.success).toBe(false);
    });

    it("rejects a title that is too short", async () => {
      await request(app).post("/api/v1/meetings").send({ title: "a", startTime: "2026-08-19T10:00:00.000Z" }).expect(422);
    });

    it("lists meetings with pagination metadata", async () => {
      const response = await request(app).get("/api/v1/meetings?limit=1").expect(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta.total).toBeGreaterThanOrEqual(2);
      expect(response.body.meta.pages).toBeGreaterThanOrEqual(2);
    });

    it("filters by search term", async () => {
      const response = await request(app).get("/api/v1/meetings?search=Legacy").expect(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].title).toBe("Legacy workflow meeting");
    });

    it("returns detail with tasks, job and file availability", async () => {
      const response = await request(app).get(`/api/v1/meetings/${meetingId}`).expect(200);
      expect(response.body.data.meeting.title).toBe("Project Review");
      expect(response.body.data.files).toEqual({ recording: false, transcript: false, notes: false });
      expect(response.body.data.live).toEqual({ joined: false, recording: false, joining: false });
    });

    it("updates a meeting", async () => {
      const response = await request(app)
        .patch(`/api/v1/meetings/${meetingId}`)
        .send({ priority: "CRITICAL", notes: "Bring the roadmap" })
        .expect(200);
      expect(response.body.data.priority).toBe("CRITICAL");
    });

    it("rejects an invalid status on update", async () => {
      await request(app).patch(`/api/v1/meetings/${meetingId}`).send({ status: "PARTY" }).expect(422);
    });

    it("404s when a recording does not exist", async () => {
      const response = await request(app).get(`/api/v1/meetings/${meetingId}/recording`).expect(404);
      expect(response.body.message).toMatch(/No recording/);
    });

    it("404s when a transcript does not exist", async () => {
      await request(app).get(`/api/v1/meetings/${meetingId}/transcript`).expect(404);
    });

    it("refuses to start a meeting that has no URL", async () => {
      const created = await Meeting.create({
        owner: (await Meeting.findById(meetingId)).owner,
        title: "No link meeting",
        startTime: new Date()
      });
      const response = await request(app).post(`/api/v1/meetings/${created._id}/start`).send({}).expect(400);
      expect(response.body.message).toMatch(/no meeting URL/i);
    });

    it("refuses a second join while the recording is being processed (409, no overwrite)", async () => {
      const owner = (await Meeting.findById(meetingId)).owner;
      const busy = await Meeting.create({
        owner,
        title: "Busy meeting",
        startTime: new Date(),
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        status: "TRANSCRIBING"
      });
      const response = await request(app).post(`/api/v1/meetings/${busy._id}/start`).send({}).expect(409);
      expect(response.body.error.code).toBe("MEETING_BUSY");
    });

    it("queues processing and reports the failure without losing the meeting", async () => {
      await request(app).post(`/api/v1/meetings/${meetingId}/process`).send({}).expect(202);

      await new Promise((resolve) => setTimeout(resolve, 500));
      const job = await request(app).get(`/api/v1/meetings/${meetingId}/job`).expect(200);
      expect(job.body.data.status).toBe("FAILED");
      expect(job.body.data.error).toMatch(/No local recording/);

      const meeting = await Meeting.findById(meetingId);
      expect(meeting.title).toBe("Project Review");
      expect(meeting.status).toBe("UPCOMING");
    });

    it("soft-deletes a meeting", async () => {
      await request(app).delete(`/api/v1/meetings/${meetingId}`).expect(200);
      await request(app).get(`/api/v1/meetings/${meetingId}`).expect(404);
      expect((await Meeting.findOne({ _id: meetingId, includeDeleted: true }).setOptions({ includeDeleted: true }))).toBeDefined();
    });
  });

  describeIfMongo()("recording metadata", () => {
    it("stores the file path and never the binary", async () => {
      const owner = (await Meeting.findOne({}).setOptions({ includeDeleted: true }))?.owner;
      const meeting = await Meeting.create({
        owner,
        title: "Recorded meeting",
        startTime: new Date(),
        recording: {
          filePath: "C:/meetai/recordings/x/meeting.mp4",
          format: "mp4",
          durationSeconds: 1800,
          sizeBytes: 42_000_000,
          recordedAt: new Date(),
          recorder: "ffmpeg-windows"
        }
      });

      const stored = await Meeting.findById(meeting._id).lean();
      expect(stored.recording.filePath).toContain("meeting.mp4");
      expect(stored.recording.durationSeconds).toBe(1800);
      expect(Object.keys(stored.recording)).not.toContain("data");

      const listed = await request(app).get("/api/v1/meetings?scope=recorded").expect(200);
      expect(listed.body.data.some((item) => item.title === "Recorded meeting")).toBe(true);
    });
  });

  describeIfMongo()("tasks", () => {
    let taskId;

    it("creates a task", async () => {
      const response = await request(app)
        .post("/api/v1/tasks")
        .send({ title: "Complete backend API", assigneeName: "Sanjith", priority: "HIGH" })
        .expect(201);
      taskId = response.body.data.id;
      expect(response.body.data.status).toBe("PENDING");
    });

    it("rejects an invalid priority", async () => {
      await request(app).post("/api/v1/tasks").send({ title: "Bad task", priority: "URGENT" }).expect(422);
    });

    it("completes a task and stamps completedAt", async () => {
      const response = await request(app).patch(`/api/v1/tasks/${taskId}`).send({ status: "COMPLETED" }).expect(200);
      expect(response.body.data.completedAt).toBeTruthy();
    });

    it("lists tasks", async () => {
      const response = await request(app).get("/api/v1/tasks").expect(200);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it("deletes a task", async () => {
      await request(app).delete(`/api/v1/tasks/${taskId}`).expect(200);
      expect(await Task.findOne({ _id: taskId })).toBeNull();
    });
  });

  describeIfMongo()("analytics and system", () => {
    it("returns an analytics overview", async () => {
      const response = await request(app).get("/api/v1/analytics").expect(200);
      expect(response.body.data).toHaveProperty("totalMeetings");
      expect(response.body.data).toHaveProperty("recordedMeetings");
      expect(response.body.data.byMonth).toHaveLength(6);
    });

    it("reports local settings without leaking secrets", async () => {
      const response = await request(app).get("/api/v1/system/settings").expect(200);
      expect(["auto", "ollama", "gemini"]).toContain(response.body.data.aiProvider);
      const body = JSON.stringify(response.body);
      expect(body).not.toMatch(/GEMINI_API_KEY|client_secret|refreshToken/i);
    });

    it("validates settings updates", async () => {
      await request(app).patch("/api/v1/system/settings").send({ aiProvider: "chatgpt" }).expect(422);
      const response = await request(app).patch("/api/v1/system/settings").send({ joinOffsetMinutes: 5 }).expect(200);
      expect(response.body.data.joinOffsetMinutes).toBe(5);
    });

    it("reports Gmail and Notion as not configured instead of failing", async () => {
      const gmail = await request(app).get("/api/v1/integrations/gmail/status").expect(200);
      expect(gmail.body.data.configured).toBe(false);
      const notion = await request(app).get("/api/v1/integrations/notion/status").expect(200);
      expect(notion.body.data.message).toMatch(/Not configured/);
    });
  });

  describeIfMongo()("scheduler", () => {
    it("selects only meetings inside the join window", async () => {
      const owner = (await Meeting.findOne({}).setOptions({ includeDeleted: true }))?.owner;
      const now = new Date();

      await Meeting.create({
        owner,
        title: "Starts in one minute",
        startTime: new Date(now.getTime() + 60_000),
        meetingUrl: "https://meet.google.com/aaa-bbbb-ccc"
      });
      await Meeting.create({
        owner,
        title: "Starts in two hours",
        startTime: new Date(now.getTime() + 2 * 3600_000),
        meetingUrl: "https://meet.google.com/ddd-eeee-fff"
      });
      await Meeting.create({
        owner,
        title: "No URL",
        startTime: new Date(now.getTime() + 60_000)
      });

      const due = await findDueMeetings(now, 2);
      const titles = due.map((meeting) => meeting.title);
      expect(titles).toContain("Starts in one minute");
      expect(titles).not.toContain("Starts in two hours");
      expect(titles).not.toContain("No URL");
    });
  });
});
