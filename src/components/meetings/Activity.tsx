import { Link } from "react-router-dom";
import { cn } from "@/utils/cn";
import type { ActivityEntry, Meeting, StageName, StageState } from "@/types/meetai";

const STATE_STYLE: Record<StageState | "INFO", string> = {
  PENDING: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  RUNNING: "bg-amber/10 text-amber",
  RETRYING: "bg-indigo/10 text-indigo",
  COMPLETED: "bg-teal/10 text-teal",
  FAILED: "bg-rose/10 text-rose",
  SKIPPED: "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500",
  INFO: "bg-sky/10 text-sky"
};

const DOT_STYLE: Record<StageState | "INFO", string> = {
  PENDING: "bg-slate-300",
  RUNNING: "bg-amber animate-pulse",
  RETRYING: "bg-indigo animate-pulse",
  COMPLETED: "bg-teal",
  FAILED: "bg-rose",
  SKIPPED: "bg-slate-300",
  INFO: "bg-sky"
};

export const STAGE_LABELS: Record<StageName, string> = {
  join: "Join",
  recording: "Recording",
  transcription: "Transcription",
  analysis: "AI analysis",
  rag: "RAG index",
  notion: "Notion",
  email: "Email"
};

const chip = "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold";

export function StageChip({ state }: { state?: StageState | "INFO" }) {
  const value = state ?? "PENDING";
  return <span className={cn(chip, STATE_STYLE[value])}>{value}</span>;
}

/** PENDING / RUNNING / COMPLETED / FAILED / RETRYING per pipeline stage. */
export function StageGrid({ stages }: { stages?: Meeting["stages"] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {(Object.keys(STAGE_LABELS) as StageName[]).map((stage) => {
        const entry = stages?.[stage];
        return (
          <div key={stage} className="rounded-md border border-line p-3 dark:border-slate-800" title={entry?.detail}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-ink dark:text-white">{STAGE_LABELS[stage]}</span>
              <StageChip state={entry?.status} />
            </div>
            {entry?.detail ? <p className="mt-1 truncate text-xs text-slate-500">{entry.detail}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function time(value: string) {
  const date = new Date(value);
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

/** Vertical timeline. `showMeeting` adds a link per row (dashboard feed). */
export function ActivityTimeline({ entries, showMeeting = false, empty = "No activity yet." }: { entries: ActivityEntry[]; showMeeting?: boolean; empty?: string }) {
  if (!entries.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <ol className="relative space-y-3 border-l border-line pl-5 dark:border-slate-800">
      {entries.map((entry) => (
        <li key={entry._id} className="relative">
          <span className={cn("absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white dark:ring-slate-900", DOT_STYLE[entry.status])} />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono text-slate-500">{time(entry.createdAt)}</span>
            <span className="font-bold uppercase text-slate-500">{STAGE_LABELS[entry.stage as StageName] ?? entry.stage}</span>
            <StageChip state={entry.status} />
            {showMeeting && entry.meeting ? (
              <Link to={`/meetings/${entry.meeting}`} className="truncate font-semibold text-teal hover:underline">
                {entry.meetingTitle ?? "meeting"}
              </Link>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-300">{entry.message}</p>
        </li>
      ))}
    </ol>
  );
}
