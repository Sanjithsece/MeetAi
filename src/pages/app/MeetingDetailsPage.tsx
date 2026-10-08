import { useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import {
  FaArrowLeft,
  FaCirclePlay,
  FaDownload,
  FaEnvelope,
  FaRotate,
  FaStop,
  FaUpRightFromSquare,
  FaVideo,
  FaWandMagicSparkles
} from "react-icons/fa6";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { PriorityBadge, StatusBadge, StepBadge } from "@/components/meetings/StatusBadge";
import { ActivityTimeline, StageGrid } from "@/components/meetings/Activity";
import { formatDateTime, formatDuration } from "@/components/meetings/MeetingCard";
import { recordingUrl } from "@/services/api/client";
import { meetaiApi } from "@/services/api/meetaiApi";
import {
  useEmailMeeting,
  useMeeting,
  useMeetingActivity,
  useProcessMeeting,
  useStartMeeting,
  useStopMeeting,
  useUpdateTask
} from "@/services/queries";
import { cn } from "@/utils/cn";

const TABS = ["overview", "activity", "recording", "transcript", "summary", "actions", "decisions", "notion"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  activity: "Activity",
  recording: "Recording",
  transcript: "Transcript",
  summary: "AI summary",
  actions: "Action items",
  decisions: "Decisions",
  notion: "Notion"
};

export function MeetingDetailsPage() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") as Tab) ?? "overview";

  const { data, isLoading, error } = useMeeting(id);
  const startMeeting = useStartMeeting();
  const stopMeeting = useStopMeeting();
  const processMeeting = useProcessMeeting();
  const emailMeeting = useEmailMeeting();

  if (isLoading) return <Card>Loading meeting...</Card>;
  if (error) return <Card><p className="text-rose">{error.message}</p></Card>;
  if (!data) return <Card>Meeting not found.</Card>;

  const { meeting, tasks, job, live, files } = data;
  const busy = job && ["QUEUED", "RUNNING"].includes(job.status);
  const actionError = startMeeting.error ?? stopMeeting.error ?? processMeeting.error ?? emailMeeting.error;
  const emailResult = emailMeeting.data;

  return (
    <div className="space-y-6">
      <Link to="/meetings" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-teal">
        <FaArrowLeft /> All meetings
      </Link>

      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={meeting.status} />
            <PriorityBadge priority={meeting.priority} />
            <span className="text-xs font-semibold uppercase text-slate-400">{meeting.source.replace("_", " ")}</span>
          </div>
          <h1 className="mt-2 text-3xl font-bold text-ink dark:text-white">{meeting.title}</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">{formatDateTime(meeting.startTime)}</p>
          {meeting.description ? <p className="mt-2 max-w-3xl text-slate-600 dark:text-slate-300">{meeting.description}</p> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {meeting.meetingUrl && !live.joined && !live.joining && !busy && !["TRANSCRIBING", "ANALYZING"].includes(meeting.status) ? (
            <Button onClick={() => startMeeting.mutate(meeting.id)} disabled={startMeeting.isPending}>
              <FaVideo /> {startMeeting.isPending ? "Starting..." : "Join & record"}
            </Button>
          ) : null}
          {live.joining && !live.joined ? (
            <Button variant="danger" onClick={() => stopMeeting.mutate(meeting.id)} disabled={stopMeeting.isPending}>
              <FaStop /> {stopMeeting.isPending ? "Cancelling..." : "Cancel join"}
            </Button>
          ) : null}
          {live.joined ? (
            <Button variant="danger" onClick={() => stopMeeting.mutate(meeting.id)} disabled={stopMeeting.isPending}>
              <FaStop /> {stopMeeting.isPending ? "Stopping..." : "Stop & save"}
            </Button>
          ) : null}
          {files.recording ? (
            <Button
              variant="secondary"
              onClick={() => processMeeting.mutate({ id: meeting.id, force: true })}
              disabled={Boolean(busy) || processMeeting.isPending}
            >
              <FaWandMagicSparkles /> {busy ? "Processing..." : "Process with AI"}
            </Button>
          ) : null}
          {meeting.aiAnalysis?.status === "COMPLETED" ? (
            <Button
              variant="secondary"
              onClick={() => emailMeeting.mutate({ id: meeting.id, kind: "summary" })}
              disabled={emailMeeting.isPending}
              title="Sends the AI summary to EMAIL_TO (or your account email)"
            >
              <FaEnvelope /> {emailMeeting.isPending ? "Sending..." : "Email summary"}
            </Button>
          ) : null}
          {meeting.notion?.pageUrl ? (
            <a
              href={meeting.notion.pageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-mist dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <FaUpRightFromSquare /> Open Notion
            </a>
          ) : null}
        </div>
      </div>

      {actionError ? <p className="rounded-md bg-rose/10 p-3 text-sm text-rose">{actionError.message}</p> : null}
      {live.joining || meeting.status === "JOINING" ? (
        <p className="rounded-md bg-indigo/10 p-3 text-sm text-indigo">
          Joining in the background: {meeting.stages?.join?.detail ?? "launching the browser"}. MeetAI retries if Meet refuses and waits for
          the host to let it in; recording starts once it is inside the call. Details in the Activity tab.
        </p>
      ) : null}
      {meeting.status === "FAILED" && meeting.automation?.lastError && !live.joining ? (
        <p className="rounded-md bg-rose/10 p-3 text-sm text-rose">Last join error: {meeting.automation.lastError}</p>
      ) : null}
      {emailResult ? (
        <p className={cn("rounded-md p-3 text-sm", emailResult.status === "SENT" ? "bg-teal/10 text-teal" : "bg-amber/10 text-amber")}>
          Email {emailResult.status.toLowerCase()}
          {emailResult.error ? `: ${emailResult.error}` : ""}
          {emailResult.status === "SKIPPED" ? " - configure EMAIL_HOST / EMAIL_USER / EMAIL_PASSWORD in .env to send emails." : ""}
        </p>
      ) : null}

      {busy && job ? (
        <Card>
          <p className="mb-2 text-sm font-semibold text-ink dark:text-white">
            Background processing: {job.step ?? job.status.toLowerCase()}
          </p>
          <ProgressBar value={job.progress} />
          <p className="mt-2 text-xs text-slate-500">
            Transcription and local model analysis run in the background. You can leave this page open.
          </p>
        </Card>
      ) : null}

      {job?.status === "FAILED" ? (
        <Card className="border-rose/40">
          <p className="text-sm font-semibold text-rose">Processing failed: {job.error}</p>
          <p className="mt-1 text-xs text-slate-500">
            The recording and any transcript are untouched. Fix the cause and press Process with AI to retry.
          </p>
        </Card>
      ) : null}

      <div className="flex gap-1 overflow-x-auto border-b border-line dark:border-slate-800">
        {TABS.map((entry) => (
          <button
            key={entry}
            onClick={() => setSearchParams(entry === "overview" ? {} : { tab: entry })}
            className={cn(
              "whitespace-nowrap px-4 py-3 text-sm font-semibold transition",
              tab === entry
                ? "border-b-2 border-teal text-teal"
                : "text-slate-500 hover:text-ink dark:hover:text-white"
            )}
          >
            {TAB_LABELS[entry]}
          </button>
        ))}
      </div>

      {tab === "overview" ? <OverviewTab meeting={meeting} /> : null}
      {tab === "activity" ? <ActivityTab meeting={meeting} busy={Boolean(busy)} /> : null}
      {tab === "recording" ? <RecordingTab meeting={meeting} available={files.recording} /> : null}
      {tab === "transcript" ? <TranscriptTab meeting={meeting} available={files.transcript} /> : null}
      {tab === "summary" ? <SummaryTab meeting={meeting} /> : null}
      {tab === "actions" ? <ActionsTab meeting={meeting} tasks={tasks} /> : null}
      {tab === "decisions" ? <DecisionsTab meeting={meeting} /> : null}
      {tab === "notion" ? <NotionTab meeting={meeting} /> : null}
    </div>
  );
}

type MeetingProp = { meeting: import("@/types/meetai").Meeting };

function OverviewTab({ meeting }: MeetingProp) {
  const rows: Array<[string, React.ReactNode]> = [
    ["Date & time", formatDateTime(meeting.startTime)],
    ["Ends", meeting.endTime ? formatDateTime(meeting.endTime) : "Not set"],
    ["Duration", meeting.durationMinutes ? `${meeting.durationMinutes} minutes` : "Not set"],
    ["Status", <StatusBadge key="status" status={meeting.status} />],
    ["Priority", <PriorityBadge key="priority" priority={meeting.priority} />],
    ["Source", meeting.source.replace("_", " ")],
    [
      "Meeting URL",
      meeting.meetingUrl ? (
        <a className="break-all text-teal hover:underline" href={meeting.meetingUrl} target="_blank" rel="noreferrer">
          {meeting.meetingUrl}
        </a>
      ) : (
        "Not set"
      )
    ],
    [
      "Participants",
      meeting.participants.length
        ? meeting.participants.map((participant) => participant.name || participant.email).filter(Boolean).join(", ")
        : "Not recorded"
    ]
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
      <Card>
        <CardHeader title="Meeting information" eyebrow="Overview" />
        <dl className="grid gap-4 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-bold uppercase text-slate-500">{label}</dt>
              <dd className="mt-1 text-sm font-semibold text-ink dark:text-white">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <CardHeader title="Processing" eyebrow="Local pipeline" />
        <div className="flex flex-wrap gap-2">
          <StepBadge label="Transcript" status={meeting.transcript?.status} />
          <StepBadge label="AI analysis" status={meeting.aiAnalysis?.status} />
          <StepBadge
            label="RAG"
            status={meeting.rag?.status ?? "PENDING"}
          />
          <StepBadge
            label="Email"
            status={meeting.email?.status === "SENT" ? "COMPLETED" : (meeting.email?.status ?? "PENDING")}
          />
        </div>

        <dl className="mt-4 space-y-3 text-sm">
          <Detail label="Recording" value={meeting.recording?.filePath ?? "Not recorded"} />
          <Detail
            label="Recording length"
            value={formatDuration(meeting.recording?.durationSeconds) ?? "Unknown"}
          />
          <Detail label="Transcript engine" value={meeting.transcript?.engine ?? "Not run"} />
          <Detail
            label="AI provider"
            value={meeting.aiAnalysis?.provider ? `${meeting.aiAnalysis.provider} (${meeting.aiAnalysis.model})` : "Not run"}
          />
        </dl>

        {meeting.recording?.error ? (
          <p className="mt-4 rounded-md bg-rose/10 p-3 text-xs text-rose">{meeting.recording.error}</p>
        ) : null}

        {meeting.statusHistory?.length ? (
          <div className="mt-5">
            <p className="text-xs font-bold uppercase text-slate-500">Recent activity</p>
            <ul className="mt-2 space-y-1 text-xs text-slate-500">
              {meeting.statusHistory.slice(-6).reverse().map((entry, index) => (
                <li key={`${entry.at}-${index}`}>
                  {new Date(entry.at).toLocaleTimeString()} · {entry.status}
                  {entry.detail ? ` — ${entry.detail}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function ActivityTab({ meeting, busy }: MeetingProp & { busy: boolean }) {
  const { data, isLoading, error } = useMeetingActivity(meeting.id, busy || ["JOINING", "RECORDING", "TRANSCRIBING", "ANALYZING"].includes(meeting.status));
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Pipeline stages" eyebrow="PENDING · RUNNING · COMPLETED · FAILED · RETRYING" />
        <StageGrid stages={data?.stages ?? meeting.stages} />
      </Card>
      <Card>
        <CardHeader title="Activity timeline" eyebrow={`${data?.timeline.length ?? 0} events`} />
        {isLoading ? <p className="text-sm text-slate-500">Loading activity...</p> : null}
        {error ? <p className="text-sm text-rose">{(error as Error).message}</p> : null}
        {data ? <ActivityTimeline entries={data.timeline} empty="Nothing has happened for this meeting yet." /> : null}
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-all text-sm text-slate-700 dark:text-slate-300">{value}</dd>
    </div>
  );
}

function RecordingTab({ meeting, available }: MeetingProp & { available: boolean }) {
  if (!available) {
    return (
      <Card>
        <CardHeader title="Recording" eyebrow="Local MP4" />
        <p className="text-sm text-slate-500">
          {meeting.recording?.error
            ? `Recording failed: ${meeting.recording.error}`
            : "No recording has been captured for this meeting yet. Use Join & record while the meeting is running."}
        </p>
      </Card>
    );
  }

  const sizeMb = meeting.recording?.sizeBytes ? (meeting.recording.sizeBytes / 1_048_576).toFixed(1) : null;

  return (
    <Card>
      <CardHeader title="Recording" eyebrow="Plays from your local disk" />
      <video className="w-full rounded-md bg-black" controls preload="metadata" src={recordingUrl(meeting.id)}>
        Your browser cannot play this MP4 file.
      </video>
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-slate-500">
        <span>Format: {meeting.recording?.format ?? "mp4"}</span>
        {formatDuration(meeting.recording?.durationSeconds) ? <span>Length: {formatDuration(meeting.recording?.durationSeconds)}</span> : null}
        {sizeMb ? <span>Size: {sizeMb} MB</span> : null}
        <a className="inline-flex items-center gap-2 font-semibold text-teal" href={recordingUrl(meeting.id)} target="_blank" rel="noreferrer">
          <FaCirclePlay /> Open in a new tab
        </a>
      </div>
      <p className="mt-3 break-all text-xs text-slate-400">Stored at {meeting.recording?.filePath}</p>
    </Card>
  );
}

function TranscriptTab({ meeting, available }: MeetingProp & { available: boolean }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["transcript", meeting.id],
    queryFn: () => meetaiApi.transcript(meeting.id),
    enabled: available
  });

  return (
    <Card>
      <CardHeader
        title="Transcript"
        eyebrow="Generated locally by Whisper"
        action={
          available ? (
            <a
              href={meetaiApi.transcriptDownloadUrl(meeting.id)}
              className="inline-flex items-center gap-2 text-sm font-semibold text-teal"
            >
              <FaDownload /> Download
            </a>
          ) : null
        }
      />
      {!available ? (
        <p className="text-sm text-slate-500">
          {meeting.transcript?.error
            ? `Transcription failed: ${meeting.transcript.error}`
            : "No transcript yet. Process the recording to generate one on this machine."}
        </p>
      ) : isLoading ? (
        <p className="text-sm text-slate-500">Loading transcript...</p>
      ) : error ? (
        <p className="text-sm text-rose">{(error as Error).message}</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-500">
            {meeting.transcript?.engine} · {meeting.transcript?.wordCount ?? 0} words ·{" "}
            {meeting.transcript?.generatedAt ? formatDateTime(meeting.transcript.generatedAt) : ""}
          </p>
          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-mist p-4 text-sm leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
            {data?.text}
          </pre>
        </>
      )}
    </Card>
  );
}

function SummaryTab({ meeting }: MeetingProp) {
  const ai = meeting.aiAnalysis;

  if (ai?.status !== "COMPLETED") {
    return (
      <Card>
        <CardHeader title="AI summary" eyebrow="Ollama + Llama 3" />
        <p className="text-sm text-slate-500">
          {ai?.error ? `AI analysis failed: ${ai.error}` : "No AI summary yet. Process the meeting to generate one locally."}
        </p>
      </Card>
    );
  }

  const fellBack = ai.attempts?.some((attempt) => attempt.outcome !== "success");

  return (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
      <Card>
        <CardHeader title={ai.title || "Summary"} eyebrow={`${ai.provider} · ${ai.model}${ai.chunked ? " · long meeting, analysed in parts" : ""}`} />
        {ai.shortSummary ? <p className="mb-3 font-semibold text-ink dark:text-white">{ai.shortSummary}</p> : null}
        <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{ai.summary}</p>
        {fellBack ? (
          <p className="mt-4 rounded-md bg-amber/10 p-2 text-xs text-amber">
            Answered by {ai.provider} after a provider fallback ({ai.attempts?.filter((a) => a.outcome !== "success").map((a) => a.provider).join(", ")} failed).
          </p>
        ) : null}
        <SummaryList title="Key points" items={ai.keyPoints} />
        <SummaryList title="Open questions" items={ai.questions} />
        <SummaryList title="Recommended follow-ups" items={ai.followUps} />
      </Card>
      <Card>
        <CardHeader title="Important topics" eyebrow={`${ai.importantTopics.length} topics`} />
        <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
          {ai.importantTopics.length ? ai.importantTopics.map((topic) => <li key={topic}>• {topic}</li>) : <li>No topics extracted.</li>}
        </ul>
        <div className="mt-5 flex flex-wrap gap-2 text-xs">
          <span className="rounded-md bg-mist px-2 py-1 font-semibold dark:bg-slate-950">Sentiment: {ai.sentiment}</span>
          <span className="rounded-md bg-mist px-2 py-1 font-semibold dark:bg-slate-950">Priority: {ai.priority}</span>
          {ai.meetingStatus ? (
            <span className="rounded-md bg-mist px-2 py-1 font-semibold dark:bg-slate-950">Outcome: {ai.meetingStatus}</span>
          ) : null}
        </div>
        {ai.peopleResponsible.length ? (
          <p className="mt-4 text-sm text-slate-500">People responsible: {ai.peopleResponsible.join(", ")}</p>
        ) : null}
      </Card>
    </div>
  );
}

function SummaryList({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-5">
      <p className="text-xs font-bold uppercase text-slate-500">{title}</p>
      <ul className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}

function ActionsTab({ meeting, tasks }: MeetingProp & { tasks: import("@/types/meetai").Task[] }) {
  const updateTask = useUpdateTask();
  const actionItems = meeting.aiAnalysis?.actionItems ?? [];

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="AI action items" eyebrow={`${actionItems.length} extracted`} />
        <div className="space-y-3">
          {actionItems.map((item, index) => (
            <div key={`${item.task}-${index}`} className="rounded-md border border-line p-4 dark:border-slate-800">
              <p className="font-semibold text-ink dark:text-white">{item.task}</p>
              <p className="mt-1 text-xs text-slate-500">
                {item.person || "Unassigned"} · {item.deadline || "No deadline stated"} · {item.priority}
              </p>
            </div>
          ))}
          {!actionItems.length ? <p className="text-sm text-slate-500">No action items extracted yet.</p> : null}
        </div>
        {meeting.aiAnalysis?.deadlines?.length ? (
          <div className="mt-5">
            <p className="text-xs font-bold uppercase text-slate-500">Deadlines</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
              {meeting.aiAnalysis.deadlines.map((entry, index) => (
                <li key={index}>• {[entry.label, entry.date, entry.person].filter(Boolean).join(" — ")}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Tasks" eyebrow={`${tasks.length} tracked`} />
        <div className="space-y-3">
          {tasks.map((task) => (
            <div key={task.id} className="flex items-start justify-between gap-3 rounded-md border border-line p-4 dark:border-slate-800">
              <div className="min-w-0">
                <p className="font-semibold text-ink dark:text-white">{task.title}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {task.assigneeName || "Unassigned"} ·{" "}
                  {task.deadline ? new Date(task.deadline).toLocaleDateString() : "No due date"} · {task.status}
                </p>
              </div>
              <Button
                variant="secondary"
                className="min-h-9 px-3 text-xs"
                disabled={task.status === "COMPLETED" || updateTask.isPending}
                onClick={() => updateTask.mutate({ id: task.id, status: "COMPLETED" })}
              >
                {task.status === "COMPLETED" ? "Done" : "Complete"}
              </Button>
            </div>
          ))}
          {!tasks.length ? <p className="text-sm text-slate-500">No tasks for this meeting.</p> : null}
        </div>
      </Card>
    </div>
  );
}

function DecisionsTab({ meeting }: MeetingProp) {
  const decisions = meeting.aiAnalysis?.decisions ?? [];
  return (
    <Card>
      <CardHeader title="Key decisions" eyebrow={`${decisions.length} recorded`} />
      <ul className="space-y-3 text-slate-700 dark:text-slate-300">
        {decisions.map((decision) => (
          <li key={decision} className="rounded-md border border-line p-4 dark:border-slate-800">
            {decision}
          </li>
        ))}
        {!decisions.length ? <li className="text-sm text-slate-500">No decisions extracted yet.</li> : null}
      </ul>
    </Card>
  );
}

function NotionTab({ meeting }: MeetingProp) {
  const [copied, setCopied] = useState(false);

  if (!meeting.notion?.pageUrl) {
    return (
      <Card>
        <CardHeader title="Notion" eyebrow="Optional integration" />
        <p className="text-sm text-slate-500">
          {meeting.notion?.error
            ? `Notion sync failed: ${meeting.notion.error}`
            : "Notion: Not configured. Add NOTION_API_KEY and NOTION_DATABASE_ID to .env to publish meeting notes automatically."}
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Notion" eyebrow="Page created" />
      <p className="text-sm text-slate-600 dark:text-slate-300">
        A Notion page was created for this meeting on{" "}
        {meeting.notion.createdAt ? formatDateTime(meeting.notion.createdAt) : "an earlier run"}.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={meeting.notion.pageUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-10 items-center gap-2 rounded-md bg-teal px-4 text-sm font-semibold text-white hover:bg-teal/90"
        >
          <FaUpRightFromSquare /> Open Notion
        </a>
        <Button
          variant="secondary"
          onClick={() => {
            navigator.clipboard.writeText(meeting.notion?.pageUrl ?? "");
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          <FaRotate /> {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </Card>
  );
}
