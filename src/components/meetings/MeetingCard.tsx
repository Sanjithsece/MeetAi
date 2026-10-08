import { Link } from "react-router-dom";
import { FaCirclePlay, FaUpRightFromSquare, FaEye } from "react-icons/fa6";
import { Card } from "@/components/ui/Card";
import { AssetBadge, PriorityBadge, StatusBadge } from "@/components/meetings/StatusBadge";
import type { Meeting } from "@/types/meetai";

export function formatDateTime(value?: string) {
  if (!value) return "No date";
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatDuration(seconds?: number | null) {
  if (!seconds) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function MeetingCard({ meeting }: { meeting: Meeting }) {
  const hasRecording = Boolean(meeting.recording?.filePath);
  const hasTranscript = meeting.transcript?.status === "COMPLETED";
  const hasSummary = meeting.aiAnalysis?.status === "COMPLETED";
  const hasNotion = Boolean(meeting.notion?.pageUrl);

  return (
    <Card className="transition hover:border-teal/40 hover:shadow-lg">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/meetings/${meeting.id}`} className="text-lg font-bold text-ink hover:text-teal dark:text-white">
              {meeting.title}
            </Link>
            <StatusBadge status={meeting.status} />
            <PriorityBadge priority={meeting.priority} />
          </div>

          <p className="mt-1 text-sm font-semibold text-slate-500">
            {formatDateTime(meeting.startTime)}
            {meeting.durationMinutes ? ` · ${meeting.durationMinutes} min` : ""}
            {` · ${meeting.source.replace("_", " ").toLowerCase()}`}
          </p>

          {meeting.description ? (
            <p className="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{meeting.description}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <AssetBadge label="Recording" ready={hasRecording} />
            <AssetBadge label="Transcript" ready={hasTranscript} />
            <AssetBadge label="AI summary" ready={hasSummary} />
            <AssetBadge
              label="Notion"
              ready={hasNotion}
              hint={hasNotion ? "Notion page created" : "Notion: Not configured or not synced"}
            />
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            to={`/meetings/${meeting.id}`}
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-mist dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          >
            <FaEye /> View
          </Link>
          {hasRecording ? (
            <Link
              to={`/meetings/${meeting.id}?tab=recording`}
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-teal px-3 text-sm font-semibold text-white hover:bg-teal/90"
            >
              <FaCirclePlay /> Play
            </Link>
          ) : null}
          {hasNotion ? (
            <a
              href={meeting.notion?.pageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-mist dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <FaUpRightFromSquare /> Notion
            </a>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
