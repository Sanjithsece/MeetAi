import fsp from "node:fs/promises";
import { env } from "../../config/env.js";
import { fileExists } from "../../config/paths.js";
import { RagDocument } from "../../models/RagDocument.js";
import { aiLogger } from "../../utils/logger.js";
import { aiManager } from "../ai/index.js";
import { buildRagPrompt, RAG_SYSTEM_PROMPT } from "../ai/prompt.js";
import { chunkText } from "./chunker.js";
import { getVectorStore } from "./vectorStores.js";

const EMBED_BATCH = 16;

/** Text MeetAI indexes for a meeting: AI notes first (dense), then the raw transcript. */
export async function meetingDocuments(meeting) {
  const docs = [];
  const ai = meeting.aiAnalysis ?? {};
  const date = meeting.startTime ? new Date(meeting.startTime).toISOString().slice(0, 10) : "";

  if (ai.status === "COMPLETED") {
    const lines = [
      `Meeting: ${meeting.title} (${date})`,
      ai.summary ? `Summary: ${ai.summary}` : "",
      ai.keyPoints?.length ? `Key points: ${ai.keyPoints.join("; ")}` : "",
      ai.importantTopics?.length ? `Topics: ${ai.importantTopics.join(", ")}` : "",
      ai.decisions?.length ? `Decisions: ${ai.decisions.join("; ")}` : "",
      ai.actionItems?.length
        ? `Action items: ${ai.actionItems.map((item) => `${item.task}${item.person ? ` (owner: ${item.person})` : ""}${item.deadline ? ` due ${item.deadline}` : ""}`).join("; ")}`
        : "",
      ai.questions?.length ? `Open questions: ${ai.questions.join("; ")}` : "",
      ai.followUps?.length ? `Follow-ups: ${ai.followUps.join("; ")}` : ""
    ].filter(Boolean);
    docs.push({ sourceType: "notes", text: lines.join("\n") });
  }

  const meta = [meeting.description, meeting.notes].filter(Boolean).join("\n");
  if (meta.trim()) docs.push({ sourceType: "meeting", text: `Meeting: ${meeting.title} (${date})\n${meta}` });

  if (meeting.transcript?.filePath && (await fileExists(meeting.transcript.filePath))) {
    docs.push({ sourceType: "transcript", text: await fsp.readFile(meeting.transcript.filePath, "utf8") });
  }
  return docs;
}

async function embedAll(texts) {
  const manager = await aiManager();
  const vectors = [];
  for (let index = 0; index < texts.length; index += EMBED_BATCH) {
    vectors.push(...(await manager.embed(texts.slice(index, index + EMBED_BATCH))));
  }
  return vectors;
}

/**
 * Replaces everything indexed for `sourceId` with fresh chunks.
 * `docs` = [{ sourceType, text }] that all belong to the same source.
 */
async function indexSource({ owner, sourceId, docs, meeting, title, date }) {
  const store = await getVectorStore();
  await store.deleteSource({ owner, sourceId });

  const pieces = docs.flatMap((doc) =>
    chunkText(doc.text, { size: env.rag.chunkSize, overlap: env.rag.chunkOverlap }).map((text, chunkIndex) => ({
      text,
      sourceType: doc.sourceType,
      chunkIndex
    }))
  );
  if (!pieces.length) return { chunks: 0, store: store.name };

  // Prefix the title so short chunks still carry their meeting context.
  const vectors = await embedAll(pieces.map((piece) => `${title ? `${title}: ` : ""}${piece.text}`));
  const records = pieces.map((piece, index) => ({
    id: `${sourceId}:${piece.sourceType}:${piece.chunkIndex}`,
    text: piece.text,
    embedding: vectors[index],
    metadata: {
      owner,
      sourceId: String(sourceId),
      sourceType: piece.sourceType,
      meeting: meeting ?? undefined,
      meetingTitle: title,
      date,
      chunkIndex: piece.chunkIndex,
      embeddingModel: env.ai.ollamaEmbeddingModel
    }
  }));

  await store.upsert(records);
  return { chunks: records.length, store: store.name };
}

export async function indexMeeting(meeting) {
  if (!env.rag.enabled) return { skipped: true, reason: "RAG_ENABLED=false" };
  const docs = await meetingDocuments(meeting);
  if (!docs.length) return { skipped: true, reason: "Nothing to index yet" };

  const result = await indexSource({
    owner: meeting.owner,
    sourceId: String(meeting._id),
    docs,
    meeting: meeting._id,
    title: meeting.title,
    date: meeting.startTime ? new Date(meeting.startTime).toISOString().slice(0, 10) : ""
  });
  aiLogger.info("RAG ingestion completed", { meetingId: String(meeting._id), ...result });
  return { skipped: false, ...result };
}

export async function removeMeeting(meeting) {
  const store = await getVectorStore();
  return store.deleteSource({ owner: meeting.owner, sourceId: String(meeting._id) });
}

export async function addDocument({ owner, title, text, type = "document" }) {
  const document = await RagDocument.create({ owner, title, text, type, characters: text.length });
  try {
    const result = await indexSource({ owner, sourceId: `doc:${document._id}`, docs: [{ sourceType: type, text }], title });
    document.chunks = result.chunks;
    document.indexedAt = new Date();
    await document.save();
    return document;
  } catch (error) {
    document.error = error.message;
    await document.save();
    throw error;
  }
}

export async function deleteDocument({ owner, id }) {
  const document = await RagDocument.findOne({ _id: id, owner });
  if (!document) return null;
  const store = await getVectorStore();
  await store.deleteSource({ owner, sourceId: `doc:${document._id}` });
  await document.deleteOne();
  return document;
}

export async function search({ owner, query, k = env.rag.topK, meetingId }) {
  const text = String(query ?? "").trim();
  if (!text) return [];
  const [embedding] = await embedAll([text]);
  const store = await getVectorStore();
  const hits = await store.query({ owner, embedding, k, meetingId });
  return hits.map((hit) => ({
    id: hit.id,
    text: hit.text,
    score: Number(hit.score.toFixed(4)),
    sourceType: hit.metadata.sourceType,
    sourceId: hit.metadata.sourceId,
    meetingId: hit.metadata.meetingId,
    meetingTitle: hit.metadata.meetingTitle,
    date: hit.metadata.date
  }));
}

/**
 * Retrieval-augmented answer. Private meeting context is answered by the local
 * model; it is only sent to Gemini when RAG_ALLOW_CLOUD=true.
 */
export async function ask({ owner, question, k = env.rag.topK, meetingId }) {
  const passages = await search({ owner, query: question, k, meetingId });
  if (!passages.length) {
    return { answer: "I could not find anything about that in your saved meetings yet.", sources: [], provider: null, model: null };
  }
  const manager = await aiManager();
  const response = await manager.generate({
    system: RAG_SYSTEM_PROMPT,
    prompt: buildRagPrompt(question, passages),
    json: false,
    purpose: "rag-answer",
    allowCloud: env.rag.allowCloud
  });
  return { answer: response.text.trim(), sources: passages, provider: response.label, model: response.model };
}

export async function ragStatus(owner) {
  const store = await getVectorStore({ force: true });
  const [health, chunks, documents] = await Promise.all([
    store.health(),
    store.count(owner).catch(() => null),
    owner ? RagDocument.countDocuments({ owner }) : 0
  ]);
  return {
    enabled: env.rag.enabled,
    ...health,
    configuredChroma: Boolean(env.rag.chromaUrl),
    embeddingModel: env.ai.ollamaEmbeddingModel,
    chunks,
    documents,
    allowCloud: env.rag.allowCloud
  };
}
