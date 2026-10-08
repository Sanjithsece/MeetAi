import { Router } from "express";
import { activityController } from "../controllers/activityController.js";
import { analyticsController } from "../controllers/analyticsController.js";
import { integrationController } from "../controllers/integrationController.js";
import { meetingController } from "../controllers/meetingController.js";
import { notificationController } from "../controllers/notificationController.js";
import { ragController } from "../controllers/ragController.js";
import { systemController } from "../controllers/systemController.js";
import { taskController } from "../controllers/taskController.js";
import { authenticate } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { ApiError } from "../utils/apiError.js";
import {
  meetingCreateSchema,
  meetingEmailSchema,
  meetingUpdateSchema,
  processRequestSchema,
  ragAskSchema,
  ragDocumentSchema,
  ragSearchSchema,
  settingsUpdateSchema,
  taskCreateSchema,
  taskUpdateSchema,
  testEmailSchema
} from "../validations/schemas.js";
import { authRoutes } from "./authRoutes.js";

export const apiRouter = Router();

// Every `:id` is a MongoDB ObjectId - reject anything else before it reaches a query.
apiRouter.param("id", (_req, _res, next, id) => {
  if (!/^[a-f0-9]{24}$/i.test(String(id))) return next(new ApiError(400, "Invalid id", undefined, "INVALID_ID"));
  return next();
});

apiRouter.use("/auth", authRoutes);

// The Gmail OAuth redirect is hit by the browser without an Authorization
// header, so it stays outside the authenticated section.
apiRouter.get("/integrations/gmail/callback", integrationController.gmailCallback);

apiRouter.use(authenticate);

// --- Meetings --------------------------------------------------------------
apiRouter.get("/meetings", meetingController.list);
apiRouter.post("/meetings", validate(meetingCreateSchema), meetingController.create);
apiRouter.get("/meetings/:id", meetingController.get);
apiRouter.patch("/meetings/:id", validate(meetingUpdateSchema), meetingController.update);
apiRouter.delete("/meetings/:id", meetingController.remove);

apiRouter.get("/meetings/:id/recording", meetingController.streamRecording);
apiRouter.get("/meetings/:id/transcript", meetingController.transcript);
apiRouter.get("/meetings/:id/notes", meetingController.notes);
apiRouter.get("/meetings/:id/job", meetingController.job);
apiRouter.get("/meetings/:id/activity", activityController.timeline);

apiRouter.post("/meetings/:id/start", meetingController.start);
apiRouter.post("/meetings/:id/stop", meetingController.stop);
apiRouter.post("/meetings/:id/process", validate(processRequestSchema), meetingController.process);
apiRouter.post("/meetings/:id/index", ragController.indexMeeting);
apiRouter.post("/meetings/:id/email", validate(meetingEmailSchema), activityController.emailMeeting);

// --- Tasks -----------------------------------------------------------------
apiRouter.get("/tasks", taskController.list);
apiRouter.post("/tasks", validate(taskCreateSchema), taskController.create);
apiRouter.patch("/tasks/:id", validate(taskUpdateSchema), taskController.update);
apiRouter.delete("/tasks/:id", taskController.remove);

// --- RAG: semantic search & Q&A over past meetings and documents ------------
apiRouter.get("/rag/status", ragController.status);
apiRouter.post("/rag/search", validate(ragSearchSchema), ragController.search);
apiRouter.post("/rag/ask", validate(ragAskSchema), ragController.ask);
apiRouter.get("/rag/documents", ragController.listDocuments);
apiRouter.post("/rag/documents", validate(ragDocumentSchema), ragController.addDocument);
apiRouter.delete("/rag/documents/:id", ragController.deleteDocument);
apiRouter.post("/rag/reindex", ragController.reindex);

// --- Activity, analytics & notifications -----------------------------------
apiRouter.get("/activity", activityController.recent);
apiRouter.get("/analytics", analyticsController.overview);
apiRouter.get("/notifications", notificationController.list);
apiRouter.patch("/notifications/:id", notificationController.markRead);

// --- System ----------------------------------------------------------------
apiRouter.get("/system/status", systemController.status);
apiRouter.get("/system/settings", systemController.settings);
apiRouter.patch("/system/settings", validate(settingsUpdateSchema), systemController.updateSettings);
apiRouter.get("/system/audio-devices", systemController.audioDevices);
apiRouter.get("/system/ai", activityController.aiStatus);
apiRouter.post("/system/ai/reset", activityController.aiReset);

// --- Email -----------------------------------------------------------------
apiRouter.post("/email/test", validate(testEmailSchema), activityController.testEmail);
apiRouter.get("/email/log", activityController.emailLog);

// --- Integrations ----------------------------------------------------------
apiRouter.post("/integrations/gmail/connect", integrationController.gmailConnect);
apiRouter.get("/integrations/gmail/status", integrationController.gmailStatus);
apiRouter.post("/integrations/gmail/sync", integrationController.gmailSync);
apiRouter.delete("/integrations/gmail", integrationController.gmailDisconnect);

apiRouter.get("/integrations/notion/status", integrationController.notionStatus);

apiRouter.post("/integrations/browser/connect", integrationController.browserConnect);
apiRouter.get("/integrations/browser/status", integrationController.browserStatus);
