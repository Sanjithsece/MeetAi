import { useState } from "react";
import { Link } from "react-router-dom";
import { FaFolderOpen } from "react-icons/fa6";
import { Card, CardHeader } from "@/components/ui/Card";
import { formatDateTime, formatDuration } from "@/components/meetings/MeetingCard";
import { StatusBadge } from "@/components/meetings/StatusBadge";
import { recordingUrl } from "@/services/api/client";
import { useMeetings, useSettings } from "@/services/queries";
import { cn } from "@/utils/cn";

export function RecordingsPage() {
  const { data, isLoading, error } = useMeetings({ scope: "recorded", sort: "newest", limit: 50 });
  const { data: settings } = useSettings();
  const recordings = data?.items ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = recordings.find((meeting) => meeting.id === selectedId) ?? recordings[0] ?? null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase text-teal">Local files</p>
        <h1 className="text-3xl font-bold text-ink dark:text-white">Recordings</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          Every recording is an MP4 on this computer. Nothing is uploaded anywhere.
        </p>
        {settings ? (
          <p className="mt-2 flex items-center gap-2 break-all text-xs text-slate-400">
            <FaFolderOpen /> {settings.recordingDir}
          </p>
        ) : null}
      </div>

      {error ? <p className="rounded-md bg-rose/10 p-3 text-sm text-rose">{error.message}</p> : null}

      {isLoading ? <Card>Loading recordings...</Card> : null}

      {!isLoading && !recordings.length ? (
        <Card>
          <p className="text-sm text-slate-500">
            No recordings yet. Open a meeting and use <span className="font-semibold">Join &amp; record</span>, or let the
            scheduler join it for you.
          </p>
        </Card>
      ) : null}

      {selected ? (
        <div className="grid gap-6 xl:grid-cols-[1.4fr_.6fr]">
          <Card>
            <CardHeader
              title={selected.title}
              eyebrow={formatDateTime(selected.recording?.recordedAt ?? selected.startTime)}
              action={
                <Link className="text-sm font-semibold text-teal" to={`/meetings/${selected.id}`}>
                  Meeting details
                </Link>
              }
            />
            <video className="w-full rounded-md bg-black" controls preload="metadata" src={recordingUrl(selected.id)} key={selected.id}>
              Your browser cannot play this MP4 file.
            </video>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-500">
              {formatDuration(selected.recording?.durationSeconds) ? (
                <span>Length: {formatDuration(selected.recording?.durationSeconds)}</span>
              ) : null}
              {selected.recording?.sizeBytes ? (
                <span>Size: {(selected.recording.sizeBytes / 1_048_576).toFixed(1)} MB</span>
              ) : null}
              {selected.recording?.recorder ? <span>Recorder: {selected.recording.recorder}</span> : null}
            </div>
          </Card>

          <Card className="p-0">
            <div className="border-b border-line px-5 py-4 dark:border-slate-800">
              <h2 className="text-lg font-bold text-ink dark:text-white">All recordings</h2>
              <p className="text-xs text-slate-500">{recordings.length} files</p>
            </div>
            <ul className="max-h-[32rem] divide-y divide-line overflow-auto dark:divide-slate-800">
              {recordings.map((meeting) => (
                <li key={meeting.id}>
                  <button
                    onClick={() => setSelectedId(meeting.id)}
                    className={cn(
                      "w-full px-5 py-4 text-left transition hover:bg-mist dark:hover:bg-slate-950",
                      selected.id === meeting.id && "bg-mist dark:bg-slate-950"
                    )}
                  >
                    <p className="truncate font-semibold text-ink dark:text-white">{meeting.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDateTime(meeting.recording?.recordedAt ?? meeting.startTime)}
                      {formatDuration(meeting.recording?.durationSeconds) ? ` · ${formatDuration(meeting.recording?.durationSeconds)}` : ""}
                    </p>
                    <div className="mt-2">
                      <StatusBadge status={meeting.status} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
