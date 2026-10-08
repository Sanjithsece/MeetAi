import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chunkText, cosineSimilarity } from "../src/services/rag/chunker.js";

/**
 * Deterministic bag-of-words embedder: lets the RAG logic (chunking, storage,
 * ranking, owner isolation, deletion) be tested exactly without Ollama.
 */
function embedText(text) {
  const vector = new Array(256).fill(0);
  for (const word of String(text).toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let hash = 0;
    for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    vector[hash % 256] += 1;
  }
  return vector;
}

const generateCalls = [];
vi.mock("../src/services/ai/index.js", () => ({
  aiManager: async () => ({
    embed: async (texts) => texts.map(embedText),
    generate: async (args) => {
      generateCalls.push(args);
      return { text: "We decided to use MongoDB [1].", label: "ollama", model: "fake", attempts: [] };
    }
  })
}));

const { createChromaVectorStore, createMongoVectorStore } = await import("../src/services/rag/vectorStores.js");
const rag = await import("../src/services/rag/ragService.js");

describe("chunking", () => {
  it("returns one chunk for short text and nothing for empty text", () => {
    expect(chunkText("hello world", { size: 100 })).toEqual(["hello world"]);
    expect(chunkText("   ")).toEqual([]);
  });

  it("splits long text into overlapping chunks on word boundaries", () => {
    const text = Array.from({ length: 400 }, (_, index) => `word${index}`).join(" ");
    const chunks = chunkText(text, { size: 300, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(300);
      // starts and ends on whole words ("word123"), never a fragment like "rd123"
      expect(chunk).toMatch(/^word\d+\b/);
      expect(chunk).toMatch(/\bword\d+$/);
    }
    // overlap: the start of chunk 2 appears at the end of chunk 1
    expect(chunks[0].includes(chunks[1].split(" ")[0])).toBe(true);
  });

  it("computes cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

const TEST_URI = process.env.TEST_MONGODB_URI_RAG ?? "mongodb://127.0.0.1:27017/meetai_test_rag";
let mongoAvailable = false;
try {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 3000 });
  mongoAvailable = true;
} catch {
  mongoAvailable = false;
}

beforeAll(async () => {
  if (mongoAvailable) await mongoose.connection.dropDatabase();
});
afterAll(async () => {
  if (mongoAvailable) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

const ownerA = new mongoose.Types.ObjectId();
const ownerB = new mongoose.Types.ObjectId();

(mongoAvailable ? describe : describe.skip)("RAG over the local MongoDB vector store", () => {
  it("indexes documents and ranks the relevant one first", async () => {
    await rag.addDocument({ owner: ownerA, title: "Database decision", text: "In the sprint meeting we decided to use MongoDB with Mongoose for storage. Sanjith owns the schema." });
    await rag.addDocument({ owner: ownerA, title: "Holiday plan", text: "The team picnic is on Friday at the lake. Bring snacks and sunscreen." });

    const results = await rag.search({ owner: ownerA, query: "which database did we decide to use mongodb" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toMatch(/MongoDB/);
    expect(results[0].score).toBeGreaterThan(results.at(-1).score - 1e-9);
  });

  it("isolates users - owner B never sees owner A's chunks", async () => {
    await rag.addDocument({ owner: ownerB, title: "B notes", text: "Owner B private roadmap about Kubernetes migration." });
    const forB = await rag.search({ owner: ownerB, query: "MongoDB decision" });
    expect(forB.every((hit) => !/MongoDB/.test(hit.text))).toBe(true);
  });

  it("answers questions with sources and keeps private context local", async () => {
    const answer = await rag.ask({ owner: ownerA, question: "What database did we decide on?" });
    expect(answer.answer).toMatch(/MongoDB/);
    expect(answer.sources.length).toBeGreaterThan(0);
    expect(generateCalls.at(-1).allowCloud).toBe(false);
    expect(generateCalls.at(-1).prompt).toMatch(/\[1\]/);
  });

  it("indexes a meeting's notes and transcript and removes them on delete", async () => {
    const meeting = {
      _id: new mongoose.Types.ObjectId(),
      owner: ownerA,
      title: "Project X sync",
      startTime: new Date("2026-09-01T10:00:00Z"),
      description: "",
      notes: "",
      aiAnalysis: {
        status: "COMPLETED",
        summary: "Project X launch moved to October.",
        decisions: ["Launch Project X on October 15"],
        actionItems: [{ task: "Prepare release notes", person: "Priya", deadline: "Oct 10" }],
        keyPoints: [],
        importantTopics: ["Project X"]
      }
    };
    const result = await rag.indexMeeting(meeting);
    expect(result.chunks).toBeGreaterThan(0);

    const hits = await rag.search({ owner: ownerA, query: "Project X launch decision" });
    expect(hits[0].meetingTitle).toBe("Project X sync");
    expect(hits[0].meetingId).toBe(String(meeting._id));

    const scoped = await rag.search({ owner: ownerA, query: "anything", meetingId: meeting._id });
    expect(scoped.every((hit) => hit.meetingId === String(meeting._id))).toBe(true);

    await rag.removeMeeting(meeting);
    const after = await rag.search({ owner: ownerA, query: "Project X launch decision" });
    expect(after.some((hit) => hit.meetingId === String(meeting._id))).toBe(false);
  });

  it("deletes a document and its vectors", async () => {
    const doc = await rag.addDocument({ owner: ownerA, title: "Temp", text: "Temporary zebra unicorn content." });
    expect((await rag.search({ owner: ownerA, query: "zebra unicorn" }))[0].text).toMatch(/zebra/);
    await rag.deleteDocument({ owner: ownerA, id: doc._id });
    expect((await rag.search({ owner: ownerA, query: "zebra unicorn" })).some((hit) => /zebra/.test(hit.text))).toBe(false);
  });

  it("reports store status", async () => {
    const status = await rag.ragStatus(ownerA);
    expect(status.store).toBe("mongodb");
    expect(status.chunks).toBeGreaterThan(0);
    const store = createMongoVectorStore();
    expect((await store.health()).available).toBe(true);
  });
});

// Runs only when a ChromaDB server is reachable (e.g. `chroma run --path ./chroma-data`).
const CHROMA_TEST_URL = process.env.TEST_CHROMA_URL ?? "http://localhost:8000";
let chromaAvailable = false;
try {
  chromaAvailable = (await fetch(`${CHROMA_TEST_URL}/api/v2/heartbeat`, { signal: AbortSignal.timeout(2000) })).ok;
} catch {
  chromaAvailable = false;
}

(chromaAvailable ? describe : describe.skip)("ChromaDB vector store (live server)", () => {

  const collection = `meetai_test_${Date.now()}`;
  const store = createChromaVectorStore({ url: CHROMA_TEST_URL, collection });
  const owner = new mongoose.Types.ObjectId();
  const other = new mongoose.Types.ObjectId();

  afterAll(async () => {
    await fetch(`${CHROMA_TEST_URL}/api/v2/tenants/default_tenant/databases/default_database/collections/${collection}`, { method: "DELETE" }).catch(() => undefined);
  });

  it("upserts, queries by owner and deletes by source", async () => {
    const record = (id, text, who, sourceId) => ({ id, text, embedding: embedText(text), metadata: { owner: who, sourceId, sourceType: "notes", meetingTitle: "T", chunkIndex: 0 } });
    await store.upsert([
      record("a", "we chose MongoDB for storage", owner, "s1"),
      record("b", "picnic at the lake on friday", owner, "s2"),
      record("c", "MongoDB secret for another user", other, "s3")
    ]);
    const hits = await store.query({ owner, embedding: embedText("which database MongoDB"), k: 3 });
    expect(hits[0].id).toBe("a");
    expect(hits.every((hit) => hit.id !== "c")).toBe(true);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);

    expect(await store.deleteSource({ owner, sourceId: "s1" })).toBe(1);
    const after = await store.query({ owner, embedding: embedText("MongoDB"), k: 3 });
    expect(after.some((hit) => hit.id === "a")).toBe(false);
    expect((await store.health()).available).toBe(true);
  });
});
