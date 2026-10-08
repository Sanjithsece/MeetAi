import mongoose from "mongoose";

/**
 * Local vector store (used when no ChromaDB server is configured): one document
 * per text chunk with its embedding. Similarity is computed in Node - fast
 * enough for a personal archive of a few thousand chunks.
 */
const ragChunkSchema = new mongoose.Schema(
  {
    _id: { type: String },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sourceId: { type: String, required: true, index: true },
    sourceType: { type: String, enum: ["transcript", "notes", "meeting", "document", "note", "preference", "profile"], required: true },
    meeting: { type: mongoose.Schema.Types.ObjectId, ref: "Meeting", index: true },
    meetingTitle: String,
    date: String,
    chunkIndex: Number,
    text: { type: String, required: true },
    embedding: { type: [Number], required: true },
    embeddingModel: String
  },
  { timestamps: true, versionKey: false }
);

ragChunkSchema.index({ owner: 1, sourceId: 1 });

export const RagChunk = mongoose.model("RagChunk", ragChunkSchema);
