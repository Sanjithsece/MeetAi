import { Meeting } from "../models/Meeting.js";
import { RagDocument } from "../models/RagDocument.js";
import { recordActivity } from "../services/activityService.js";
import { runRagIngest } from "../services/pipeline/meetingPipeline.js";
import * as rag from "../services/rag/ragService.js";
import { ApiError } from "../utils/apiError.js";
import { success } from "../utils/apiResponse.js";

/** Upstream AI failures surface as 503 with a stable code instead of a generic 500. */
function forward(next) {
  return (error) => {
    if (error.code === "AI_PROVIDER_UNAVAILABLE" || error.name === "AIProviderError") {
      return next(new ApiError(503, error.message, undefined, "AI_PROVIDER_UNAVAILABLE"));
    }
    return next(error);
  };
}

export const ragController = {
  async status(req, res, next) {
    try {
      success(res, await rag.ragStatus(req.user._id));
    } catch (error) {
      next(error);
    }
  },

  async search(req, res, next) {
    try {
      const results = await rag.search({ owner: req.user._id, query: req.body.query, k: req.body.k, meetingId: req.body.meetingId });
      success(res, { query: req.body.query, results });
    } catch (error) {
      forward(next)(error);
    }
  },

  async ask(req, res, next) {
    try {
      success(res, await rag.ask({ owner: req.user._id, question: req.body.question, k: req.body.k, meetingId: req.body.meetingId }));
    } catch (error) {
      forward(next)(error);
    }
  },

  async listDocuments(req, res, next) {
    try {
      const documents = await RagDocument.find({ owner: req.user._id }).select("-text").sort({ createdAt: -1 }).limit(200);
      success(res, documents);
    } catch (error) {
      next(error);
    }
  },

  async addDocument(req, res, next) {
    try {
      const document = await rag.addDocument({ owner: req.user._id, ...req.body });
      await recordActivity({ owner: req.user._id, stage: "rag", status: "COMPLETED", message: `Document "${document.title}" indexed (${document.chunks} chunks)` });
      const { text: _text, ...rest } = document.toJSON();
      success(res, rest, "Document indexed", 201);
    } catch (error) {
      forward(next)(error);
    }
  },

  async deleteDocument(req, res, next) {
    try {
      const removed = await rag.deleteDocument({ owner: req.user._id, id: req.params.id });
      if (!removed) throw new ApiError(404, "Document not found");
      success(res, { id: removed._id }, "Document removed");
    } catch (error) {
      next(error);
    }
  },

  /** (Re)indexes one meeting now. */
  async indexMeeting(req, res, next) {
    try {
      const meeting = await Meeting.findOne({ _id: req.params.id, owner: req.user._id, isDeleted: false });
      if (!meeting) throw new ApiError(404, "Meeting not found");
      success(res, await runRagIngest(meeting._id), "Meeting indexed");
    } catch (error) {
      forward(next)(error);
    }
  },

  /** Re-indexes every meeting and document - used after switching vector store. */
  async reindex(req, res, next) {
    try {
      const meetings = await Meeting.find({ owner: req.user._id, isDeleted: false }).select("_id");
      let indexed = 0;
      for (const meeting of meetings) {
        const result = await runRagIngest(meeting._id);
        if (!result.skipped) indexed += 1;
      }
      const documents = await RagDocument.find({ owner: req.user._id });
      for (const document of documents) {
        await rag.deleteDocument({ owner: req.user._id, id: document._id });
        await rag.addDocument({ owner: req.user._id, title: document.title, text: document.text, type: document.type });
      }
      success(res, { meetings: meetings.length, indexed, documents: documents.length }, "Re-index finished");
    } catch (error) {
      forward(next)(error);
    }
  }
};
