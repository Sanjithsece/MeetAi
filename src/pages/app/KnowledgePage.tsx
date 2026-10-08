import { useState } from "react";
import { Link } from "react-router-dom";
import { FaArrowsRotate, FaFileArrowUp, FaMagnifyingGlass, FaPaperPlane, FaTrash } from "react-icons/fa6";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import {
  useAddRagDocument,
  useDeleteRagDocument,
  useRagAsk,
  useRagDocuments,
  useRagReindex,
  useRagSearch,
  useSystemStatus
} from "@/services/queries";
import type { RagDocument, RagHit } from "@/types/meetai";
import { cn } from "@/utils/cn";

const EXAMPLES = [
  "What decisions were made in my previous meeting?",
  "What tasks were assigned to me?",
  "What did we discuss about Project X?",
  "Which meetings mentioned MongoDB?"
];

const control =
  "w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal dark:border-slate-700 dark:bg-slate-950 dark:text-white";

/**
 * Retrieval-augmented Q&A over past meetings and personal documents.
 * Embeddings (embeddinggemma) and answers (Ollama) stay on this computer.
 */
export function KnowledgePage() {
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<"ask" | "search">("ask");
  const ask = useRagAsk();
  const search = useRagSearch();
  const { data: status } = useSystemStatus();
  const rag = status?.rag;

  const submit = (text = question) => {
    const value = text.trim();
    if (value.length < 3) return;
    setQuestion(value);
    if (mode === "ask") ask.mutate({ question: value });
    else search.mutate({ query: value });
  };

  const pending = ask.isPending || search.isPending;
  const error = ask.error ?? search.error;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase text-teal">Retrieval-augmented generation</p>
        <h1 className="text-3xl font-bold text-ink dark:text-white">Ask your meetings</h1>
        <p className="mt-2 max-w-3xl text-slate-600 dark:text-slate-300">
          Search transcripts, AI notes and your own documents by meaning. Embeddings and answers are produced locally
          {rag ? ` (${rag.embeddingModel} → ${rag.store})` : ""}.
        </p>
      </div>

      <Card>
        <div className="mb-3 flex gap-2">
          {(["ask", "search"] as const).map((entry) => (
            <button
              key={entry}
              onClick={() => setMode(entry)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-semibold",
                mode === entry ? "bg-teal text-white" : "bg-mist text-slate-600 dark:bg-slate-950 dark:text-slate-300"
              )}
            >
              {entry === "ask" ? "Ask (AI answer)" : "Semantic search"}
            </button>
          ))}
        </div>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            aria-label="Question"
            className={control}
            placeholder={mode === "ask" ? "Ask anything about your past meetings..." : "Search for a topic, name or phrase..."}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <Button disabled={pending || question.trim().length < 3}>
            {mode === "ask" ? <FaPaperPlane /> : <FaMagnifyingGlass />} {pending ? "Thinking..." : mode === "ask" ? "Ask" : "Search"}
          </Button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              className="rounded-md border border-line px-2 py-1 text-xs text-slate-500 hover:border-teal hover:text-teal dark:border-slate-700"
              onClick={() => submit(example)}
            >
              {example}
            </button>
          ))}
        </div>
        {error ? <p className="mt-4 rounded-md bg-rose/10 p-3 text-sm text-rose">{error.message}</p> : null}
      </Card>

      {mode === "ask" && ask.data ? (
        <Card>
          <CardHeader title="Answer" eyebrow={ask.data.provider ? `${ask.data.provider} · ${ask.data.model}` : "No matching context"} />
          <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{ask.data.answer}</p>
          <Sources hits={ask.data.sources} />
        </Card>
      ) : null}

      {mode === "search" && search.data ? (
        <Card>
          <CardHeader title="Search results" eyebrow={`${search.data.results.length} passages`} />
          <Sources hits={search.data.results} />
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <AddDocument />
        <DocumentList />
      </div>
    </div>
  );
}

function Sources({ hits }: { hits: RagHit[] }) {
  if (!hits.length) return <p className="mt-4 text-sm text-slate-500">No passages matched.</p>;
  return (
    <div className="mt-5 space-y-3">
      <p className="text-xs font-bold uppercase text-slate-500">Sources</p>
      {hits.map((hit, index) => (
        <div key={hit.id} className="rounded-md border border-line p-3 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold text-teal">[{index + 1}]</span>
            {hit.meetingId ? (
              <Link className="font-semibold text-ink hover:text-teal dark:text-white" to={`/meetings/${hit.meetingId}`}>
                {hit.meetingTitle ?? "Meeting"}
              </Link>
            ) : (
              <span className="font-semibold text-ink dark:text-white">{hit.meetingTitle ?? "Document"}</span>
            )}
            {hit.date ? <span className="text-slate-500">{hit.date}</span> : null}
            <span className="rounded bg-mist px-1.5 py-0.5 text-slate-500 dark:bg-slate-950">{hit.sourceType}</span>
            <span className="ml-auto font-mono text-slate-400">score {hit.score.toFixed(3)}</span>
          </div>
          <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{hit.text}</p>
        </div>
      ))}
    </div>
  );
}

function AddDocument() {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [type, setType] = useState<RagDocument["type"]>("document");
  const add = useAddRagDocument();

  const loadFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 200_000) {
      add.reset();
      alert("Please choose a text file under 200 KB.");
      return;
    }
    setTitle((current) => current || file.name.replace(/\.(txt|md)$/i, ""));
    setText(await file.text());
  };

  return (
    <Card>
      <CardHeader title="Add knowledge" eyebrow="Documents, notes, preferences, profile" />
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate({ title: title.trim(), text, type }, { onSuccess: () => { setTitle(""); setText(""); } });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <input aria-label="Title" className={control} placeholder="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
          <select aria-label="Type" className={control} value={type} onChange={(event) => setType(event.target.value as RagDocument["type"])}>
            <option value="document">Document</option>
            <option value="note">Note</option>
            <option value="preference">Preference</option>
            <option value="profile">Profile</option>
          </select>
        </div>
        <textarea
          aria-label="Text"
          className={cn(control, "min-h-36")}
          placeholder="Paste text, or load a .txt / .md file below"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-teal">
            <FaFileArrowUp /> Load .txt / .md
            <input type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={(event) => loadFile(event.target.files?.[0])} />
          </label>
          <Button className="ml-auto" disabled={add.isPending || !title.trim() || !text.trim()}>
            {add.isPending ? "Indexing..." : "Add to knowledge base"}
          </Button>
        </div>
        {add.error ? <p className="text-sm text-rose">{add.error.message}</p> : null}
        {add.data ? <p className="text-sm text-teal">Indexed "{add.data.title}" ({add.data.chunks} chunks).</p> : null}
      </form>
    </Card>
  );
}

function DocumentList() {
  const { data: documents = [], isLoading } = useRagDocuments();
  const remove = useDeleteRagDocument();
  const reindex = useRagReindex();

  return (
    <Card>
      <CardHeader
        title="Knowledge base"
        eyebrow={`${documents.length} document(s)`}
        action={
          <Button variant="secondary" className="min-h-9 px-3 text-xs" onClick={() => reindex.mutate()} disabled={reindex.isPending}>
            <FaArrowsRotate /> {reindex.isPending ? "Re-indexing..." : "Re-index all"}
          </Button>
        }
      />
      {reindex.data ? (
        <p className="mb-3 text-xs text-teal">
          Re-indexed {reindex.data.indexed}/{reindex.data.meetings} meetings and {reindex.data.documents} documents.
        </p>
      ) : null}
      {isLoading ? <p className="text-sm text-slate-500">Loading...</p> : null}
      <div className="space-y-2">
        {documents.map((document) => (
          <div key={document._id} className="flex items-center justify-between gap-3 rounded-md border border-line p-3 dark:border-slate-800">
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink dark:text-white">{document.title}</p>
              <p className="text-xs text-slate-500">
                {document.type} · {document.characters.toLocaleString()} chars · {document.chunks ?? 0} chunks
                {document.error ? ` · error: ${document.error}` : ""}
              </p>
            </div>
            <Button variant="secondary" className="min-h-9 px-3 text-xs" onClick={() => remove.mutate(document._id)} disabled={remove.isPending} aria-label={`Delete ${document.title}`}>
              <FaTrash />
            </Button>
          </div>
        ))}
        {!isLoading && !documents.length ? (
          <p className="text-sm text-slate-500">Meetings are indexed automatically after AI analysis. Add your own notes or documents here.</p>
        ) : null}
      </div>
    </Card>
  );
}
