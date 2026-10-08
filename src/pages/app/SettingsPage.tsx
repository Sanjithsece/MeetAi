import { useEffect, useState } from "react";
import { FaArrowsRotate, FaChrome, FaCircleCheck, FaCircleXmark, FaEnvelope } from "react-icons/fa6";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { meetaiApi } from "@/services/api/meetaiApi";
import { useGmailSync, useSettings, useSystemStatus, useTestEmail, useUpdateSettings } from "@/services/queries";
import type { Settings } from "@/types/meetai";
import { cn } from "@/utils/cn";

const control =
  "min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-teal dark:border-slate-700 dark:bg-slate-950";
const label = "text-xs font-bold uppercase tracking-wide text-slate-500";

function StatusRow({
  name,
  ok,
  message,
  disabled,
  okLabel = "Connected",
  failLabel = "Unavailable"
}: {
  name: string;
  ok: boolean;
  message: string;
  disabled?: boolean;
  okLabel?: string;
  failLabel?: string;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-line py-3 last:border-0 dark:border-slate-800">
      <span className={cn("mt-0.5 text-lg", disabled ? "text-slate-300" : ok ? "text-teal" : "text-rose")}>
        {disabled ? <FaCircleXmark className="text-slate-300" /> : ok ? <FaCircleCheck /> : <FaCircleXmark />}
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-ink dark:text-white">
          {name}{" "}
          <span className={cn("ml-1 text-xs font-bold", disabled ? "text-slate-400" : ok ? "text-teal" : "text-rose")}>
            {disabled ? "Disabled" : ok ? okLabel : failLabel}
          </span>
        </p>
        <p className="text-sm text-slate-500">{message}</p>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { data: status, isLoading: statusLoading, refetch } = useSystemStatus();
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const gmailSync = useGmailSync();
  const testEmail = useTestEmail();

  const [form, setForm] = useState<Partial<Settings>>({});
  const [devices, setDevices] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const patch = (next: Partial<Settings>) => setForm((current) => ({ ...current, ...next }));

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    updateSettings.mutate(
      {
        aiProvider: form.aiProvider,
        ollamaUrl: form.ollamaUrl,
        ollamaModel: form.ollamaModel,
        whisperImplementation: form.whisperImplementation,
        whisperModel: form.whisperModel,
        whisperLanguage: form.whisperLanguage,
        joinOffsetMinutes: Number(form.joinOffsetMinutes ?? 2),
        schedulerEnabled: form.schedulerEnabled,
        autoProcessAfterRecording: form.autoProcessAfterRecording,
        createTasksFromActionItems: form.createTasksFromActionItems,
        recorderAudioDevice: form.recorderAudioDevice,
        meetingDisplayName: form.meetingDisplayName
      },
      { onSuccess: () => setNotice("Settings saved") }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <p className="text-sm font-semibold uppercase text-teal">Local configuration</p>
          <h1 className="text-3xl font-bold text-ink dark:text-white">Settings</h1>
        </div>
        <Button variant="secondary" onClick={() => refetch()}>
          <FaArrowsRotate /> Refresh status
        </Button>
      </div>

      {notice ? <p className="rounded-md bg-teal/10 p-3 text-sm text-teal">{notice}</p> : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader title="Integration status" eyebrow="Local services" />
          {statusLoading || !status ? (
            <p className="text-sm text-slate-500">Checking local services...</p>
          ) : (
            <div>
              <StatusRow name="MongoDB" ok={Boolean(status.mongodb.available)} message={status.mongodb.message} />
              <StatusRow
                name="Ollama"
                ok={Boolean(status.ollama.available && status.ollama.modelReady)}
                okLabel="Ready"
                failLabel="Not ready"
                message={status.ollama.message}
              />
              <StatusRow
                name="Whisper"
                ok={Boolean(status.whisper.available)}
                okLabel="Available"
                failLabel="Not installed"
                message={status.whisper.message}
              />
              <StatusRow
                name="FFmpeg"
                ok={Boolean(status.ffmpeg.available)}
                okLabel="Available"
                failLabel="Not installed"
                message={status.ffmpeg.message}
              />
              <StatusRow
                name="Recorder"
                ok={Boolean(status.recorder.audioReady)}
                okLabel="Ready"
                failLabel="Needs setup"
                message={status.recorder.message}
              />
              <StatusRow
                name="Gmail"
                ok={Boolean(status.gmail.connected)}
                disabled={!status.gmail.configured}
                message={status.gmail.message}
              />
              <StatusRow
                name="Notion"
                ok={Boolean(status.notion.connected)}
                disabled={!status.notion.configured}
                message={status.notion.message}
              />
              <StatusRow
                name={`Gemini fallback${status.gemini.keys?.length ? ` (${status.gemini.keys.length} key${status.gemini.keys.length > 1 ? "s" : ""})` : ""}`}
                ok={Boolean(status.gemini.available)}
                disabled={!status.gemini.configured}
                okLabel="Configured"
                message={[
                  status.gemini.message,
                  ...(status.gemini.keys ?? []).filter((key) => key.skipped).map((key) => `${key.label}: ${key.skipped}`)
                ].join(" · ")}
              />
              <StatusRow
                name={`RAG (${status.rag?.store ?? "unknown"})`}
                ok={Boolean(status.rag?.available)}
                disabled={status.rag ? !status.rag.enabled : true}
                okLabel="Ready"
                message={`${status.rag?.message ?? ""}${status.rag?.chunks != null ? ` · ${status.rag.chunks} chunks indexed` : ""}`}
              />
              <StatusRow
                name="Email"
                ok={Boolean(status.email?.configured && status.email?.connected !== false)}
                disabled={!status.email?.configured}
                okLabel="Ready"
                message={status.email?.message ?? ""}
              />
              <StatusRow
                name="Scheduler"
                ok={status.scheduler.running}
                okLabel="Running"
                failLabel="Stopped"
                message={
                  status.scheduler.running
                    ? `Running - joins meetings ${settings?.joinOffsetMinutes ?? 2} minutes early`
                    : "Stopped"
                }
              />
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="What works offline" eyebrow="Local-first" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-bold uppercase text-teal">No internet needed</p>
              <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                {(status?.offline.worksOffline ?? []).map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-amber">Requires internet</p>
              <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                {(status?.offline.needsInternet ?? []).map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>
          </div>

          {settings ? (
            <dl className="mt-6 space-y-2 text-xs text-slate-500">
              <div>
                <dt className="font-bold uppercase">Recordings</dt>
                <dd className="break-all">{settings.recordingDir}</dd>
              </div>
              <div>
                <dt className="font-bold uppercase">Transcripts</dt>
                <dd className="break-all">{settings.transcriptDir}</dd>
              </div>
              <div>
                <dt className="font-bold uppercase">Meeting notes</dt>
                <dd className="break-all">{settings.meetingNotesDir}</dd>
              </div>
              <div>
                <dt className="font-bold uppercase">Browser profile</dt>
                <dd className="break-all">{settings.browserProfileDir}</dd>
              </div>
            </dl>
          ) : null}
        </Card>
      </div>

      <Card>
        <CardHeader title="Local engines" eyebrow="AI, transcription and automation" />
        <form className="grid gap-4 lg:grid-cols-2" onSubmit={save}>
          <div>
            <label className={label} htmlFor="ai-provider">
              AI provider
            </label>
            <select
              id="ai-provider"
              className={control}
              value={form.aiProvider ?? "auto"}
              onChange={(event) => patch({ aiProvider: event.target.value as Settings["aiProvider"] })}
            >
              <option value="auto">Auto - local Ollama first, Gemini keys only if it fails (recommended)</option>
              <option value="ollama">Local only - Ollama, nothing leaves this computer</option>
              <option value="gemini" disabled={!settings?.geminiConfigured}>
                Gemini first, Ollama fallback {settings?.geminiConfigured ? "" : "- set GEMINI_API_KEY_1 first"}
              </option>
            </select>
            <p className="mt-1 text-xs text-slate-500">
              {settings?.geminiKeyCount ?? 0} Gemini key(s) configured in .env ({settings?.geminiModel}).
              {settings && !settings.cloudFallback ? " AI_CLOUD_FALLBACK=false: Auto never uses Gemini." : ""} Keys are read
              only by the backend.
            </p>
          </div>

          <div>
            <label className={label} htmlFor="display-name">
              Join name in meetings
            </label>
            <input
              id="display-name"
              className={control}
              placeholder="Sanjith"
              value={form.meetingDisplayName ?? ""}
              onChange={(event) => patch({ meetingDisplayName: event.target.value })}
            />
            <p className="mt-1 text-xs text-slate-500">
              Used when Meet asks for a name. A signed-in Google profile joins with that account's name instead. Joins retry{" "}
              {settings?.joinRetries ?? 10}× every {settings?.joinRetryDelaySeconds ?? 30} s and wait up to {settings?.lobbyMaxMinutes ?? 15} min
              for the host to let MeetAI in.
            </p>
          </div>

          <div>
            <label className={label} htmlFor="ollama-url">
              Ollama URL
            </label>
            <input id="ollama-url" className={control} value={form.ollamaUrl ?? ""} onChange={(event) => patch({ ollamaUrl: event.target.value })} />
          </div>

          <div>
            <label className={label} htmlFor="ollama-model">
              Ollama model
            </label>
            <input id="ollama-model" className={control} value={form.ollamaModel ?? ""} onChange={(event) => patch({ ollamaModel: event.target.value })} />
          </div>

          <div>
            <label className={label} htmlFor="whisper-impl">
              Whisper implementation
            </label>
            <select
              id="whisper-impl"
              className={control}
              value={form.whisperImplementation ?? "auto"}
              onChange={(event) => patch({ whisperImplementation: event.target.value })}
            >
              {["auto", "faster-whisper", "openai-whisper", "whisper-cpp"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={label} htmlFor="whisper-model">
              Whisper model
            </label>
            <input id="whisper-model" className={control} value={form.whisperModel ?? ""} onChange={(event) => patch({ whisperModel: event.target.value })} />
          </div>

          <div>
            <label className={label} htmlFor="whisper-language">
              Whisper language
            </label>
            <input
              id="whisper-language"
              className={control}
              value={form.whisperLanguage ?? ""}
              onChange={(event) => patch({ whisperLanguage: event.target.value })}
            />
          </div>

          <div>
            <label className={label} htmlFor="join-offset">
              Join meetings this many minutes early
            </label>
            <input
              id="join-offset"
              className={control}
              type="number"
              min={0}
              max={60}
              value={form.joinOffsetMinutes ?? 2}
              onChange={(event) => patch({ joinOffsetMinutes: Number(event.target.value) })}
            />
          </div>

          <div>
            <label className={label} htmlFor="audio-device">
              Recording audio device
            </label>
            <div className="flex gap-2">
              <input
                id="audio-device"
                className={control}
                placeholder="e.g. Stereo Mix (Realtek Audio)"
                value={form.recorderAudioDevice ?? ""}
                onChange={(event) => patch({ recorderAudioDevice: event.target.value })}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  const result = await meetaiApi.audioDevices();
                  setDevices(result.devices);
                  setNotice(result.devices.length ? "Audio devices detected" : "No capture devices reported by FFmpeg");
                }}
              >
                Detect
              </Button>
            </div>
            {devices.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {devices.map((device) => (
                  <button
                    key={device}
                    type="button"
                    className="rounded-md border border-line px-2 py-1 text-xs dark:border-slate-700"
                    onClick={() => patch({ recorderAudioDevice: device })}
                  >
                    {device}
                  </button>
                ))}
              </div>
            ) : null}
            {status?.recorder.requirements ? (
              <p className="mt-2 text-xs text-slate-500">{status.recorder.requirements}</p>
            ) : null}
          </div>

          <div className="space-y-3 lg:col-span-2">
            <Toggle
              label="Run the meeting scheduler (auto-join upcoming meetings)"
              checked={form.schedulerEnabled ?? true}
              onChange={(checked) => patch({ schedulerEnabled: checked })}
            />
            <Toggle
              label="Transcribe and analyse automatically after a recording ends"
              checked={form.autoProcessAfterRecording ?? true}
              onChange={(checked) => patch({ autoProcessAfterRecording: checked })}
            />
            <Toggle
              label="Create tasks from AI action items"
              checked={form.createTasksFromActionItems ?? true}
              onChange={(checked) => patch({ createTasksFromActionItems: checked })}
            />
          </div>

          {updateSettings.error ? (
            <p className="rounded-md bg-rose/10 p-3 text-sm text-rose lg:col-span-2">{updateSettings.error.message}</p>
          ) : null}

          <div className="lg:col-span-2">
            <Button type="submit" disabled={updateSettings.isPending}>
              {updateSettings.isPending ? "Saving..." : "Save settings"}
            </Button>
          </div>
        </form>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Google Meet browser session" eyebrow="No password is ever stored" />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            MeetAI joins meetings with a local Chromium profile. Sign in to Google once in the window it opens; the
            session is reused for every later meeting and never leaves this computer.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  const result = await meetaiApi.browserConnect();
                  setNotice(result.message);
                } catch (error) {
                  setNotice((error as Error).message);
                }
              }}
            >
              <FaChrome /> Connect browser session
            </Button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            You can also run <code className="rounded bg-mist px-1 dark:bg-slate-950">npm run connect:browser</code> from
            a terminal.
          </p>
        </Card>

        <Card>
          <CardHeader title="Gmail" eyebrow="Optional - OAuth only" />
          {status?.gmail.configured ? (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-300">{status.gmail.message}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const { authUrl } = await meetaiApi.gmailConnect();
                    window.open(authUrl, "_blank", "noopener");
                  }}
                >
                  <FaEnvelope /> {status.gmail.connected ? "Reconnect Gmail" : "Connect Gmail"}
                </Button>
                {status.gmail.connected ? (
                  <Button variant="secondary" onClick={() => gmailSync.mutate()} disabled={gmailSync.isPending}>
                    {gmailSync.isPending ? "Scanning..." : "Scan Gmail now"}
                  </Button>
                ) : null}
              </div>
              {gmailSync.data ? (
                <p className="mt-3 text-sm text-teal">
                  Scanned {gmailSync.data.scanned} messages · {gmailSync.data.created} new meetings ·{" "}
                  {gmailSync.data.updated} updated
                </p>
              ) : null}
              {gmailSync.error ? <p className="mt-3 text-sm text-rose">{gmailSync.error.message}</p> : null}
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Gmail is not configured. Create an OAuth client in Google Cloud Console, then set GOOGLE_CLIENT_ID and
              GOOGLE_CLIENT_SECRET in <code>.env</code>. MeetAI never asks for your Gmail password.
            </p>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Email notifications" eyebrow="Optional - free SMTP (e.g. Gmail App Password)" />
        <p className="text-sm text-slate-600 dark:text-slate-300">{status?.email?.message ?? "Checking..."}</p>
        <p className="mt-2 text-xs text-slate-500">
          Set EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD and EMAIL_TO in .env. Summaries are emailed automatically
          after AI analysis when EMAIL_TO is set. Credentials never leave the backend.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => testEmail.mutate(undefined)} disabled={testEmail.isPending}>
            <FaEnvelope /> {testEmail.isPending ? "Sending..." : "Send test email"}
          </Button>
          {testEmail.data ? (
            <span className={cn("text-sm", testEmail.data.status === "SENT" ? "text-teal" : "text-amber")}>
              {testEmail.data.status}
              {testEmail.data.error ? `: ${testEmail.data.error}` : ""}
            </span>
          ) : null}
          {testEmail.error ? <span className="text-sm text-rose">{testEmail.error.message}</span> : null}
        </div>
      </Card>

      <Card>
        <CardHeader title="Notion" eyebrow="Optional" />
        <p className="text-sm text-slate-600 dark:text-slate-300">{status?.notion.message ?? "Checking..."}</p>
        {!status?.notion.configured ? (
          <p className="mt-2 text-sm text-slate-500">
            Add NOTION_API_KEY and NOTION_DATABASE_ID to <code>.env</code> to publish meeting notes. Everything
            else keeps working without it.
          </p>
        ) : null}
      </Card>
    </div>
  );
}

function Toggle({ label: text, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
      <input type="checkbox" className="h-5 w-5 accent-teal" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {text}
    </label>
  );
}
