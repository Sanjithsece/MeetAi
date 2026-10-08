import mongoose from "mongoose";

/** A user-supplied knowledge item (document, note, preference, profile) indexed for RAG. */
const ragDocumentSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    type: { type: String, enum: ["document", "note", "preference", "profile"], default: "document" },
    // Kept so the archive can be re-indexed (e.g. after switching to ChromaDB).
    text: { type: String, required: true },
    characters: Number,
    chunks: Number,
    indexedAt: Date,
    error: String
  },
  { timestamps: true, versionKey: false, toJSON: { virtuals: true } }
);

export const RagDocument = mongoose.model("RagDocument", ragDocumentSchema);
