import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useCreateMeeting } from "@/services/queries";
import type { Priority } from "@/types/meetai";

const field =
  "min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-teal dark:border-slate-700 dark:bg-slate-950";
const label = "text-xs font-bold uppercase tracking-wide text-slate-500";

function toIso(date: string, time: string) {
  // Interpreted in the user's own timezone - this is a local desktop app.
  return new Date(`${date}T${time}`).toISOString();
}

function todayValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function MeetingForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createMeeting = useCreateMeeting();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayValue());
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("11:00");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [participants, setParticipants] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    createMeeting.mutate(
      {
        title,
        description,
        meetingUrl: meetingUrl.trim() || undefined,
        startTime: toIso(date, startTime),
        endTime: endTime ? toIso(date, endTime) : undefined,
        priority,
        participants: participants
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
          .map((entry) => (entry.includes("@") ? { email: entry } : { name: entry }))
      },
      {
        onSuccess: () => {
          setTitle("");
          setDescription("");
          setMeetingUrl("");
          setParticipants("");
          onClose();
        }
      }
    );
  };

  return (
    <Modal title="Add meeting" open={open} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <div>
          <label className={label} htmlFor="meeting-title">
            Meeting title
          </label>
          <input
            id="meeting-title"
            className={field}
            required
            minLength={2}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Project review"
          />
        </div>

        <div>
          <label className={label} htmlFor="meeting-description">
            Description
          </label>
          <textarea
            id="meeting-description"
            className={`${field} min-h-20 py-2`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What is this meeting about?"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={label} htmlFor="meeting-date">
              Date
            </label>
            <input id="meeting-date" className={field} type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="meeting-start">
              Start time
            </label>
            <input id="meeting-start" className={field} type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="meeting-end">
              End time
            </label>
            <input id="meeting-end" className={field} type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
          </div>
        </div>

        <div>
          <label className={label} htmlFor="meeting-url">
            Meeting URL
          </label>
          <input
            id="meeting-url"
            className={field}
            type="url"
            value={meetingUrl}
            onChange={(event) => setMeetingUrl(event.target.value)}
            placeholder="https://meet.google.com/abc-defg-hij"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <div>
            <label className={label} htmlFor="meeting-participants">
              Participants
            </label>
            <input
              id="meeting-participants"
              className={field}
              value={participants}
              onChange={(event) => setParticipants(event.target.value)}
              placeholder="name or email, comma separated"
            />
          </div>
          <div>
            <label className={label} htmlFor="meeting-priority">
              Priority
            </label>
            <select
              id="meeting-priority"
              className={field}
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
            >
              {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>

        {createMeeting.error ? (
          <p className="rounded-md bg-rose/10 p-3 text-sm text-rose">{createMeeting.error.message}</p>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={createMeeting.isPending}>
            {createMeeting.isPending ? "Saving..." : "Save meeting"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
