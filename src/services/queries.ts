import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { meetaiApi } from "@/services/api/meetaiApi";
import type { MeetingInput, MeetingListQuery, Settings, Task } from "@/types/meetai";

const ACTIVE_STATUSES = ["JOINING", "RECORDING", "TRANSCRIBING", "ANALYZING"];

export function useMeetings(query: MeetingListQuery = {}) {
  return useQuery({
    queryKey: ["meetings", query],
    queryFn: () => meetaiApi.meetings(query),
    placeholderData: (previous) => previous
  });
}

/**
 * Polls every few seconds while the meeting is being recorded or processed, so
 * the detail page follows the pipeline without a websocket.
 */
export function useMeeting(id?: string) {
  return useQuery({
    queryKey: ["meeting", id],
    queryFn: () => meetaiApi.meeting(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const detail = query.state.data;
      if (!detail) return false;
      const busyJob = detail.job && ["QUEUED", "RUNNING"].includes(detail.job.status);
      const busyMeeting = ACTIVE_STATUSES.includes(detail.meeting.status);
      return busyJob || busyMeeting ? 4000 : false;
    }
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [analytics, today, upcoming, recent, tasks] = await Promise.all([
        meetaiApi.analytics(),
        meetaiApi.meetings({ scope: "today", limit: 10 }),
        meetaiApi.meetings({ scope: "upcoming", limit: 5, sort: "oldest" }),
        meetaiApi.meetings({ limit: 6 }),
        meetaiApi.tasks()
      ]);
      return { analytics, today: today.items, upcoming: upcoming.items, recent: recent.items, tasks };
    },
    refetchInterval: 30000
  });
}

export function useTasks(query: { status?: string; overdue?: boolean } = {}) {
  return useQuery({ queryKey: ["tasks", query], queryFn: () => meetaiApi.tasks(query) });
}

export function useAnalytics() {
  return useQuery({ queryKey: ["analytics"], queryFn: meetaiApi.analytics });
}

export function useSystemStatus(includeBrowser = false) {
  return useQuery({
    queryKey: ["system-status", includeBrowser],
    queryFn: () => meetaiApi.systemStatus(includeBrowser),
    refetchInterval: 60000
  });
}

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: meetaiApi.settings });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return (keys: string[]) => Promise.all(keys.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
}

export function useCreateMeeting() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (payload: MeetingInput) => meetaiApi.createMeeting(payload),
    onSuccess: () => invalidate(["meetings", "dashboard", "analytics"])
  });
}

export function useUpdateMeeting() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<MeetingInput> & { id: string; status?: string }) =>
      meetaiApi.updateMeeting(id, payload),
    onSuccess: () => invalidate(["meetings", "meeting", "dashboard"])
  });
}

export function useDeleteMeeting() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => meetaiApi.deleteMeeting(id),
    onSuccess: () => invalidate(["meetings", "dashboard", "analytics"])
  });
}

export function useStartMeeting() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => meetaiApi.startMeeting(id),
    onSuccess: () => invalidate(["meeting", "meetings", "dashboard"])
  });
}

export function useStopMeeting() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => meetaiApi.stopMeeting(id),
    onSuccess: () => invalidate(["meeting", "meetings", "dashboard"])
  });
}

export function useProcessMeeting() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, force, steps }: { id: string; force?: boolean; steps?: string[] }) =>
      meetaiApi.processMeeting(id, { force, steps }),
    onSuccess: () => invalidate(["meeting", "meetings"])
  });
}

export function useCreateTask() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (payload: Partial<Task> & { title: string }) => meetaiApi.createTask(payload),
    onSuccess: () => invalidate(["tasks", "dashboard", "analytics", "meeting"])
  });
}

export function useUpdateTask() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<Task> & { id: string }) => meetaiApi.updateTask(id, payload),
    onSuccess: () => invalidate(["tasks", "dashboard", "analytics", "meeting"])
  });
}

export function useDeleteTask() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => meetaiApi.deleteTask(id),
    onSuccess: () => invalidate(["tasks", "dashboard", "analytics"])
  });
}

export function useUpdateSettings() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => meetaiApi.updateSettings(patch),
    onSuccess: () => invalidate(["settings", "system-status"])
  });
}

export function useGmailSync() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => meetaiApi.gmailSync(),
    onSuccess: () => invalidate(["meetings", "dashboard", "system-status"])
  });
}

// --- Activity, RAG and email -------------------------------------------------

/** Per-meeting stage grid + timeline; polls while the meeting is busy. */
export function useMeetingActivity(id?: string, busy = false) {
  return useQuery({
    queryKey: ["meeting-activity", id],
    queryFn: () => meetaiApi.activity(id as string),
    enabled: Boolean(id),
    refetchInterval: busy ? 4000 : false
  });
}

export function useRecentActivity(limit = 15) {
  return useQuery({ queryKey: ["activity", limit], queryFn: () => meetaiApi.recentActivity(limit), refetchInterval: 15000 });
}

export function useRagDocuments() {
  return useQuery({ queryKey: ["rag-documents"], queryFn: meetaiApi.ragDocuments });
}

export function useRagAsk() {
  return useMutation({ mutationFn: ({ question, meetingId }: { question: string; meetingId?: string }) => meetaiApi.ragAsk(question, meetingId) });
}

export function useRagSearch() {
  return useMutation({ mutationFn: ({ query, meetingId }: { query: string; meetingId?: string }) => meetaiApi.ragSearch(query, meetingId) });
}

export function useAddRagDocument() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: meetaiApi.addRagDocument,
    onSuccess: () => invalidate(["rag-documents", "system-status", "activity"])
  });
}

export function useDeleteRagDocument() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: meetaiApi.deleteRagDocument, onSuccess: () => invalidate(["rag-documents", "system-status"]) });
}

export function useRagReindex() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: meetaiApi.ragReindex, onSuccess: () => invalidate(["rag-documents", "system-status", "meeting"]) });
}

export function useEmailMeeting() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, kind }: { id: string; kind?: "summary" | "transcript" | "actions" }) => meetaiApi.emailMeeting(id, kind),
    onSuccess: () => invalidate(["meeting", "meeting-activity", "activity"])
  });
}

export function useTestEmail() {
  return useMutation({ mutationFn: (to?: string) => meetaiApi.testEmail(to) });
}
