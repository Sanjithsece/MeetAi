import { useState } from "react";
import { Link } from "react-router-dom";
import { FaCalendarCheck, FaClock, FaListCheck, FaPlus, FaVideo } from "react-icons/fa6";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { MeetingCard, formatDateTime } from "@/components/meetings/MeetingCard";
import { MeetingForm } from "@/components/meetings/MeetingForm";
import { PriorityBadge, StatusBadge } from "@/components/meetings/StatusBadge";
import { ActivityTimeline } from "@/components/meetings/Activity";
import { useDashboard, useRecentActivity, useSystemStatus } from "@/services/queries";

export function DashboardPage() {
  const { data, isLoading, error } = useDashboard();
  const { data: activity = [] } = useRecentActivity(12);
  const { data: status } = useSystemStatus();
  const [formOpen, setFormOpen] = useState(false);

  const analytics = data?.analytics;
  const today = data?.today ?? [];
  const upcoming = data?.upcoming ?? [];
  const recent = data?.recent ?? [];
  const tasks = data?.tasks ?? [];
  const pendingTasks = tasks.filter((task) => task.status !== "COMPLETED");

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-semibold uppercase text-teal">Personal AI meeting assistant</p>
          <h1 className="text-3xl font-bold text-ink dark:text-white">Dashboard</h1>
          <p className="mt-2 max-w-3xl text-slate-600 dark:text-slate-300">
            Meetings, recordings, transcripts and AI notes - all stored on this computer.
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <FaPlus /> Add meeting
        </Button>
      </div>

      {error ? <p className="rounded-md bg-rose/10 p-3 text-sm text-rose">{error.message}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Today" value={isLoading ? "..." : today.length} icon={<FaCalendarCheck />} />
        <Metric label="Upcoming" value={isLoading ? "..." : upcoming.length} icon={<FaClock />} />
        <Metric label="Completed" value={isLoading ? "..." : analytics?.statusBreakdown?.COMPLETED ?? 0} icon={<FaCalendarCheck />} />
        <Metric label="Recorded" value={isLoading ? "..." : analytics?.recordedMeetings ?? 0} icon={<FaVideo />} />
        <Metric label="Pending tasks" value={isLoading ? "..." : analytics?.pendingTasks ?? 0} icon={<FaListCheck />} />
      </div>

      <SystemStrip status={status} />

      <div className="grid gap-6 xl:grid-cols-[1fr_.8fr]">
        <Card>
          <CardHeader title="Today's meetings" eyebrow={`${today.length} scheduled`} />
          <div className="space-y-3">
            {today.map((meeting) => (
              <Link
                key={meeting.id}
                to={`/meetings/${meeting.id}`}
                className="block rounded-md border border-line p-4 transition hover:border-teal/50 dark:border-slate-800"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-ink dark:text-white">{meeting.title}</p>
                    <p className="mt-1 text-sm text-slate-500">{formatDateTime(meeting.startTime)}</p>
                  </div>
                  <div className="flex gap-2">
                    <StatusBadge status={meeting.status} />
                    <PriorityBadge priority={meeting.priority} />
                  </div>
                </div>
              </Link>
            ))}
            {!isLoading && !today.length ? <p className="text-sm text-slate-500">No meetings scheduled for today.</p> : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="Upcoming meetings" eyebrow={`${upcoming.length} queued`} />
          <div className="space-y-3">
            {upcoming.map((meeting) => (
              <Link key={meeting.id} to={`/meetings/${meeting.id}`} className="block rounded-md bg-mist p-4 dark:bg-slate-950">
                <p className="font-bold text-ink dark:text-white">{meeting.title}</p>
                <p className="mt-1 text-sm text-slate-500">{formatDateTime(meeting.startTime)}</p>
                {meeting.automation?.autoJoin && meeting.meetingUrl ? (
                  <p className="mt-2 text-xs font-semibold uppercase text-teal">Auto-join armed</p>
                ) : (
                  <p className="mt-2 text-xs font-semibold uppercase text-slate-400">Manual join</p>
                )}
              </Link>
            ))}
            {!isLoading && !upcoming.length ? <p className="text-sm text-slate-500">Nothing upcoming.</p> : null}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Pipeline activity" eyebrow="Recording · transcription · AI · RAG · email" />
        <ActivityTimeline entries={activity} showMeeting empty="No pipeline activity yet. Process a meeting to see each stage here." />
      </Card>

      <Card>
        <CardHeader title="Pending tasks" eyebrow={`${pendingTasks.length} open`} action={<Link className="text-sm font-semibold text-teal" to="/tasks">View all</Link>} />
        <div className="space-y-2">
          {pendingTasks.slice(0, 5).map((task) => (
            <div key={task.id} className="flex items-center justify-between gap-3 rounded-md border border-line p-3 dark:border-slate-800">
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink dark:text-white">{task.title}</p>
                <p className="text-xs text-slate-500">
                  {task.assigneeName || "Unassigned"} ·{" "}
                  {task.deadline ? new Date(task.deadline).toLocaleDateString() : "No due date"}
                  {task.aiGenerated ? " · from AI" : ""}
                </p>
              </div>
              <PriorityBadge priority={task.priority} />
            </div>
          ))}
          {!pendingTasks.length ? <p className="text-sm text-slate-500">No pending tasks.</p> : null}
        </div>
      </Card>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink dark:text-white">Recent meetings</h2>
          <Link className="text-sm font-semibold text-teal" to="/meetings">
            All meetings
          </Link>
        </div>
        <div className="grid gap-4">
          {recent.map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} />
          ))}
          {!isLoading && !recent.length ? (
            <Card>
              <p className="text-sm text-slate-500">
                No meetings yet. Use <span className="font-semibold">Add meeting</span> to create one, or connect Gmail
                from Settings to detect them automatically.
              </p>
            </Card>
          ) : null}
        </div>
      </div>

      <MeetingForm open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  );
}

type StatusData = ReturnType<typeof useSystemStatus>["data"];

/** One-glance health of every local engine the pipeline depends on. */
function SystemStrip({ status }: { status: StatusData }) {
  if (!status) return null;
  const geminiKeys = status.gemini.keys?.length ?? 0;
  const items: Array<{ label: string; ok: boolean; optional?: boolean; detail: string }> = [
    { label: "MongoDB", ok: Boolean(status.mongodb.available), detail: status.mongodb.message },
    { label: "Ollama", ok: Boolean(status.ollama.available && status.ollama.modelReady), detail: status.ollama.message },
    {
      label: `Gemini fallback${geminiKeys ? ` (${geminiKeys} key${geminiKeys > 1 ? "s" : ""})` : ""}`,
      ok: Boolean(status.gemini.configured),
      optional: true,
      detail: status.gemini.message
    },
    { label: "Whisper", ok: Boolean(status.whisper.available), detail: status.whisper.message },
    { label: "FFmpeg", ok: Boolean(status.ffmpeg.available), detail: status.ffmpeg.message },
    { label: `RAG (${status.rag?.store ?? "?"})`, ok: Boolean(status.rag?.available), detail: status.rag?.message ?? "" },
    { label: "Email", ok: Boolean(status.email?.configured), optional: true, detail: status.email?.message ?? "" },
    { label: "Notion", ok: Boolean(status.notion.connected), optional: true, detail: status.notion.message }
  ];
  return (
    <div className="flex flex-wrap gap-2" aria-label="System status">
      {items.map((item) => (
        <span
          key={item.label}
          title={item.detail}
          className={
            "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold " +
            (item.ok
              ? "border-teal/30 bg-teal/10 text-teal"
              : item.optional
                ? "border-line bg-white text-slate-400 dark:border-slate-800 dark:bg-slate-900"
                : "border-rose/30 bg-rose/10 text-rose")
          }
        >
          <span className={"h-2 w-2 rounded-full " + (item.ok ? "bg-teal" : item.optional ? "bg-slate-300" : "bg-rose")} />
          {item.label}
          {!item.ok && item.optional ? " · off" : ""}
        </span>
      ))}
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-bold text-ink dark:text-white">{value}</p>
        </div>
        <span className="grid h-11 w-11 place-items-center rounded-md bg-teal/10 text-lg text-teal">{icon}</span>
      </div>
    </Card>
  );
}
