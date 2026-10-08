import { env } from "../../config/env.js";
import { RagChunk } from "../../models/RagChunk.js";
import { logger } from "../../utils/logger.js";
import { cosineSimilarity } from "./chunker.js";

/**
 * Two interchangeable vector stores with the same interface:
 *   upsert(records), query({ owner, embedding, k, meetingId }), deleteSource({ owner, sourceId }), count(owner)
 *
 * ChromaDB is used when CHROMA_URL is set and reachable; otherwise vectors live
 * in the local MongoDB, so RAG works without any extra service.
 */

export function createMongoVectorStore() {
  return {
    name: "mongodb",

    async upsert(records) {
      if (!records.length) return 0;
      await RagChunk.bulkWrite(
        records.map((record) => ({
          replaceOne: { filter: { _id: record.id }, replacement: { _id: record.id, ...record.metadata, text: record.text, embedding: record.embedding }, upsert: true }
        }))
      );
      return records.length;
    },

    async query({ owner, embedding, k = env.rag.topK, meetingId }) {
      const filter = { owner };
      if (meetingId) filter.meeting = meetingId;
      const rows = await RagChunk.find(filter).select("-__v").lean();
      return rows
        .map((row) => ({
          id: row._id,
          text: row.text,
          score: cosineSimilarity(embedding, row.embedding),
          metadata: {
            sourceId: row.sourceId,
            sourceType: row.sourceType,
            meetingId: row.meeting ? String(row.meeting) : undefined,
            meetingTitle: row.meetingTitle,
            date: row.date,
            chunkIndex: row.chunkIndex
          }
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },

    async deleteSource({ owner, sourceId }) {
      const result = await RagChunk.deleteMany({ owner, sourceId });
      return result.deletedCount ?? 0;
    },

    async count(owner) {
      return RagChunk.countDocuments(owner ? { owner } : {});
    },

    async health() {
      return { available: true, store: "mongodb", message: "Vectors stored in local MongoDB (no ChromaDB configured)" };
    }
  };
}

/** Minimal ChromaDB v2 REST client (Chroma >= 1.0). */
export function createChromaVectorStore({
  url = env.rag.chromaUrl,
  collection = env.rag.chromaCollection,
  tenant = env.rag.chromaTenant,
  database = env.rag.chromaDatabase
} = {}) {
  const base = `${url}/api/v2/tenants/${encodeURIComponent(tenant)}/databases/${encodeURIComponent(database)}`;
  let collectionId = null;

  async function call(path, { method = "POST", body, timeoutMs = 30000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`ChromaDB ${method} ${path.replace(url, "")} failed (${response.status}): ${text.slice(0, 200)}`);
      return text ? JSON.parse(text) : {};
    } catch (error) {
      if (error.name === "AbortError") throw new Error(`ChromaDB timed out after ${timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function ensureCollection() {
    if (collectionId) return collectionId;
    const created = await call(`${base}/collections`, {
      body: { name: collection, get_or_create: true, metadata: { "hnsw:space": "cosine" } }
    });
    collectionId = created.id;
    return collectionId;
  }

  const clean = (metadata) => Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, typeof value === "object" ? String(value) : value]));

  return {
    name: "chromadb",

    async upsert(records) {
      if (!records.length) return 0;
      const id = await ensureCollection();
      await call(`${base}/collections/${id}/upsert`, {
        body: {
          ids: records.map((record) => record.id),
          embeddings: records.map((record) => record.embedding),
          documents: records.map((record) => record.text),
          metadatas: records.map((record) =>
            clean({ ...record.metadata, owner: String(record.metadata.owner), meeting: record.metadata.meeting ? String(record.metadata.meeting) : undefined })
          )
        }
      });
      return records.length;
    },

    async query({ owner, embedding, k = env.rag.topK, meetingId }) {
      const id = await ensureCollection();
      const where = meetingId
        ? { $and: [{ owner: { $eq: String(owner) } }, { meeting: { $eq: String(meetingId) } }] }
        : { owner: { $eq: String(owner) } };
      const result = await call(`${base}/collections/${id}/query`, {
        body: { query_embeddings: [embedding], n_results: k, where, include: ["documents", "metadatas", "distances"] }
      });
      const ids = result.ids?.[0] ?? [];
      return ids.map((chunkId, index) => {
        const metadata = result.metadatas?.[0]?.[index] ?? {};
        return {
          id: chunkId,
          text: result.documents?.[0]?.[index] ?? "",
          // cosine distance -> similarity
          score: 1 - (result.distances?.[0]?.[index] ?? 1),
          metadata: { ...metadata, meetingId: metadata.meeting }
        };
      });
    },

    async deleteSource({ owner, sourceId }) {
      const id = await ensureCollection();
      const result = await call(`${base}/collections/${id}/delete`, {
        body: { where: { $and: [{ owner: { $eq: String(owner) } }, { sourceId: { $eq: String(sourceId) } }] } }
      });
      return result.deleted ?? 0;
    },

    async count() {
      const id = await ensureCollection();
      return call(`${base}/collections/${id}/count`, { method: "GET" });
    },

    async health() {
      try {
        await call(`${url}/api/v2/heartbeat`, { method: "GET", timeoutMs: 3000 });
        return { available: true, store: "chromadb", url, collection, message: `ChromaDB reachable at ${url}` };
      } catch (error) {
        return { available: false, store: "chromadb", url, message: `ChromaDB unreachable at ${url}: ${error.message}` };
      }
    }
  };
}

let resolved = null;
let resolvedAt = 0;

/**
 * Picks the store once a minute: ChromaDB when configured and up, MongoDB
 * otherwise (logged, so a stopped Chroma server is visible in the logs).
 */
export async function getVectorStore({ force = false } = {}) {
  if (!force && resolved && Date.now() - resolvedAt < 60_000) return resolved;
  if (env.rag.chromaUrl) {
    const chroma = createChromaVectorStore();
    const health = await chroma.health();
    if (health.available) {
      resolved = chroma;
    } else {
      logger.warn("ChromaDB unavailable, using the MongoDB vector store", { url: env.rag.chromaUrl, error: health.message });
      resolved = createMongoVectorStore();
    }
  } else {
    resolved = createMongoVectorStore();
  }
  resolvedAt = Date.now();
  return resolved;
}
