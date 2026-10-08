import { useState } from "react";
import { FaMagnifyingGlass, FaPlus } from "react-icons/fa6";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MeetingCard } from "@/components/meetings/MeetingCard";
import { MeetingForm } from "@/components/meetings/MeetingForm";
import { useMeetings } from "@/services/queries";
import type { MeetingListQuery } from "@/types/meetai";
import { cn } from "@/utils/cn";

const control =
  "min-h-11 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-teal dark:border-slate-700 dark:bg-slate-950";

const SCOPES = [
  { key: "upcoming", label: "Upcoming" },
  { key: "previous", label: "Previous" },
  { key: undefined, label: "All" }
] as const;

const STATUSES = [
  "UPCOMING",
  "JOINING",
  "RECORDING",
  "RECORDING_COMPLETED",
  "RECORDING_FAILED",
  "TRANSCRIBING",
  "ANALYZING",
  "COMPLETED",
  "FAILED",
  "CANCELLED"
];

export function MeetingsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [query, setQuery] = useState<MeetingListQuery>({ scope: "upcoming", sort: "oldest", page: 1, limit: 10 });
  const [searchInput, setSearchInput] = useState("");

  const { data, isLoading, isFetching, error } = useMeetings(query);
  const meetings = data?.items ?? [];
  const meta = data?.meta;

  const patch = (next: Partial<MeetingListQuery>) => setQuery((current) => ({ ...current, page: 1, ...next }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <p className="text-sm font-semibold uppercase text-teal">Meeting management</p>
          <h1 className="text-3xl font-bold text-ink dark:text-white">Meetings</h1>
          <p className="mt-1 max-w-2xl text-slate-600 dark:text-slate-300">
            Search, filter and open any meeting stored in your local database.
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <FaPlus /> Add meeting
        </Button>
      </div>

      {error ? <p className="rounded-md bg-rose/10 p-3 text-sm text-rose">{error.message}</p> : null}

      <Card>
        <div className="flex flex-wrap gap-2">
          {SCOPES.map((scope) => (
            <button
              key={scope.label}
              onClick={() =>
                patch({ scope: scope.key, sort: scope.key === "upcoming" ? "oldest" : "newest" })
              }
              className={cn(
                "rounded-md px-3 py-2 text-sm font-semibold transition",
                query.scope === scope.key
                  ? "bg-teal text-white"
                  : "border border-line text-slate-600 hover:bg-mist dark:border-slate-700 dark:text-slate-300"
              )}
            >
              {scope.label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_180px_180px_180px]">
          <form
            className="flex items-center gap-2 rounded-md border border-line bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
            onSubmit={(event) => {
              event.preventDefault();
              patch({ search: searchInput.trim() || undefined });
            }}
          >
            <FaMagnifyingGlass className="text-slate-400" />
            <input
              className="min-h-11 flex-1 bg-transparent text-sm outline-none"
              placeholder="Search meeting titles"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </form>

          <select
            className={control}
            value={query.status ?? ""}
            onChange={(event) => patch({ status: event.target.value || undefined })}
          >
            <option value="">All statuses</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </select>

          <input
            className={control}
            type="date"
            value={query.from?.slice(0, 10) ?? ""}
            onChange={(event) => patch({ from: event.target.value ? new Date(event.target.value).toISOString() : undefined })}
          />

          <select
            className={control}
            value={query.sort ?? "newest"}
            onChange={(event) => patch({ sort: event.target.value as MeetingListQuery["sort"] })}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="title">Title A-Z</option>
            <option value="priority">Priority</option>
          </select>
        </div>
      </Card>

      <div className="grid gap-4">
        {isLoading ? <Card>Loading meetings...</Card> : null}
        {meetings.map((meeting) => (
          <MeetingCard key={meeting.id} meeting={meeting} />
        ))}
        {!isLoading && !meetings.length ? (
          <Card>
            <p className="text-sm text-slate-500">No meetings match these filters.</p>
          </Card>
        ) : null}
      </div>

      {meta && meta.pages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-500">
            Page {meta.page} of {meta.pages} · {meta.total} meetings
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={meta.page <= 1 || isFetching}
              onClick={() => setQuery((current) => ({ ...current, page: (current.page ?? 1) - 1 }))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={meta.page >= meta.pages || isFetching}
              onClick={() => setQuery((current) => ({ ...current, page: (current.page ?? 1) + 1 }))}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <MeetingForm open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  );
}
