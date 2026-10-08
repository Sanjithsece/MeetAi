import { cn } from "@/utils/cn";
import type { MeetingStatus, Priority, StepStatus } from "@/types/meetai";

const MEETING_STATUS_STYLE: Record<MeetingStatus, { label: string; className: string }> = {
  UPCOMING: { label: "Upcoming", className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  JOINING: { label: "Joining", className: "bg-indigo/10 text-indigo" },
  RECORDING: { label: "Recording", className: "bg-rose/10 text-rose" },
  RECORDING_COMPLETED: { label: "Recorded", className: "bg-sky/10 text-sky" },
  RECORDING_FAILED: { label: "Recording failed", className: "bg-rose/10 text-rose" },
  TRANSCRIBING: { label: "Transcribing", className: "bg-amber/10 text-amber" },
  ANALYZING: { label: "Analyzing", className: "bg-amber/10 text-amber" },
  COMPLETED: { label: "Completed", className: "bg-teal/10 text-teal" },
  FAILED: { label: "Failed", className: "bg-rose/10 text-rose" },
  CANCELLED: { label: "Cancelled", className: "bg-slate-100 text-slate-500 dark:bg-slate-800" }
};

const PRIORITY_STYLE: Record<Priority, string> = {
  LOW: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  MEDIUM: "bg-sky/10 text-sky",
  HIGH: "bg-amber/10 text-amber",
  CRITICAL: "bg-rose/10 text-rose"
};

const chip = "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold";

export function StatusBadge({ status }: { status: MeetingStatus }) {
  const style = MEETING_STATUS_STYLE[status] ?? MEETING_STATUS_STYLE.UPCOMING;
  const live = status === "RECORDING" || status === "JOINING";
  return (
    <span className={cn(chip, style.className)}>
      {live ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" /> : null}
      {style.label}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={cn(chip, PRIORITY_STYLE[priority])}>{priority}</span>;
}

/** Small availability chip used on meeting cards: Recording / Transcript / AI / Notion. */
export function AssetBadge({ label, ready, hint }: { label: string; ready: boolean; hint?: string }) {
  return (
    <span
      title={hint ?? (ready ? `${label}: available` : `${label}: not available`)}
      className={cn(
        chip,
        ready ? "bg-teal/10 text-teal" : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", ready ? "bg-teal" : "bg-slate-400")} />
      {label}
    </span>
  );
}

export function StepBadge({ label, status }: { label: string; status?: StepStatus | "SKIPPED" }) {
  const map: Record<StepStatus | "SKIPPED", string> = {
    SKIPPED: "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500",
    PENDING: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
    PROCESSING: "bg-amber/10 text-amber",
    COMPLETED: "bg-teal/10 text-teal",
    FAILED: "bg-rose/10 text-rose"
  };
  return <span className={cn(chip, map[status ?? "PENDING"])}>{label}: {(status ?? "PENDING").toLowerCase()}</span>;
}
