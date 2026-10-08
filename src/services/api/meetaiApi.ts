import { apiClient } from "@/services/api/client";
import type { AuthSession, AuthUser, LoginCredentials, RegisterPayload } from "@/types/auth";
import type {
  ActivityEntry,
  Analytics,
  EmailResult,
  Meeting,
  MeetingDetail,
  MeetingInput,
  MeetingListQuery,
  Paginated,
  ProcessingJob,
  RagAnswer,
  RagDocument,
  RagHit,
  Settings,
  SystemStatus,
  Task
} from "@/types/meetai";

type ApiEnvelope<T> = { success: boolean; message: string; data: T; meta?: Paginated<T>["meta"] };

function unwrap<T>(response: { data: ApiEnvelope<T> }) {
  return response.data.data;
}

/** Mongo documents arrive with both `_id` and the `id` virtual - normalise. */
function withId<T extends { _id?: string; id?: string }>(item: T) {
  const { _id, ...rest } = item;
  return { ...rest, id: item.id ?? _id ?? "" } as T & { id: string };
}

function toQuery(params: Record<string, unknown>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export const meetaiApi = {
  // --- session ------------------------------------------------------------
  async me() {
    return withId(unwrap(await apiClient.get<ApiEnvelope<AuthUser & { _id?: string }>>("/auth/me"))) as AuthUser;
  },
  async login(credentials: LoginCredentials): Promise<AuthSession> {
    const data = unwrap(
      await apiClient.post<ApiEnvelope<{ user: AuthUser & { _id?: string }; accessToken: string; refreshToken?: string }>>("/auth/login", credentials)
    );
    return { user: withId(data.user) as AuthUser, token: data.accessToken, refreshToken: data.refreshToken };
  },
  async register(payload: RegisterPayload): Promise<AuthSession> {
    const data = unwrap(
      await apiClient.post<ApiEnvelope<{ user: AuthUser & { _id?: string }; accessToken: string; refreshToken?: string }>>("/auth/register", payload)
    );
    return { user: withId(data.user) as AuthUser, token: data.accessToken, refreshToken: data.refreshToken };
  },
  async logout() {
    await apiClient.post("/auth/logout", {}).catch(() => undefined);
  },

  // --- meetings -----------------------------------------------------------
  async meetings(query: MeetingListQuery = {}): Promise<Paginated<Meeting>> {
    const response = await apiClient.get<ApiEnvelope<Array<Meeting & { _id?: string }>>>(`/meetings${toQuery(query)}`);
    return {
      items: response.data.data.map(withId) as Meeting[],
      meta: response.data.meta ?? { page: 1, limit: response.data.data.length, total: response.data.data.length, pages: 1 }
    };
  },
  async meeting(id: string): Promise<MeetingDetail> {
    const detail = unwrap(await apiClient.get<ApiEnvelope<MeetingDetail>>(`/meetings/${id}`));
    return {
      ...detail,
      meeting: withId(detail.meeting) as Meeting,
      tasks: (detail.tasks ?? []).map(withId) as Task[],
      job: detail.job ? (withId(detail.job) as ProcessingJob) : null
    };
  },
  async createMeeting(payload: MeetingInput) {
    return withId(unwrap(await apiClient.post<ApiEnvelope<Meeting>>("/meetings", payload))) as Meeting;
  },
  async updateMeeting(id: string, payload: Partial<MeetingInput> & { status?: string }) {
    return withId(unwrap(await apiClient.patch<ApiEnvelope<Meeting>>(`/meetings/${id}`, payload))) as Meeting;
  },
  async deleteMeeting(id: string) {
    return unwrap(await apiClient.delete<ApiEnvelope<{ id: string }>>(`/meetings/${id}`));
  },
  async transcript(id: string) {
    return unwrap(
      await apiClient.get<ApiEnvelope<{ text: string; meta: Meeting["transcript"] }>>(`/meetings/${id}/transcript`)
    );
  },
  transcriptDownloadUrl(id: string) {
    return `${apiClient.defaults.baseURL}/meetings/${id}/transcript?download=true`;
  },
  async startMeeting(id: string) {
    return unwrap(await apiClient.post<ApiEnvelope<{ joined?: boolean; joining?: boolean; recording?: boolean; error?: string }>>(`/meetings/${id}/start`, {}));
  },
  async stopMeeting(id: string) {
    return unwrap(await apiClient.post<ApiEnvelope<unknown>>(`/meetings/${id}/stop`, {}));
  },
  async processMeeting(id: string, body: { steps?: string[]; force?: boolean } = {}) {
    return withId(unwrap(await apiClient.post<ApiEnvelope<ProcessingJob>>(`/meetings/${id}/process`, body))) as ProcessingJob;
  },
  async activity(id: string) {
    return unwrap(
      await apiClient.get<ApiEnvelope<{ stages: Meeting["stages"]; timeline: ActivityEntry[] }>>(`/meetings/${id}/activity`)
    );
  },
  async recentActivity(limit = 20) {
    return unwrap(await apiClient.get<ApiEnvelope<ActivityEntry[]>>(`/activity?limit=${limit}`));
  },
  async emailMeeting(id: string, kind: "summary" | "transcript" | "actions" = "summary", to?: string) {
    return unwrap(await apiClient.post<ApiEnvelope<EmailResult>>(`/meetings/${id}/email`, { kind, ...(to ? { to } : {}) }));
  },
  async indexMeeting(id: string) {
    return unwrap(await apiClient.post<ApiEnvelope<{ chunks?: number; store?: string; skipped?: boolean }>>(`/meetings/${id}/index`, {}));
  },
  async job(id: string) {
    const job = unwrap(await apiClient.get<ApiEnvelope<ProcessingJob | null>>(`/meetings/${id}/job`));
    return job ? (withId(job) as ProcessingJob) : null;
  },

  // --- tasks --------------------------------------------------------------
  async tasks(query: { status?: string; meeting?: string; overdue?: boolean } = {}) {
    const data = unwrap(await apiClient.get<ApiEnvelope<Task[]>>(`/tasks${toQuery(query)}`));
    return data.map(withId) as Task[];
  },
  async createTask(payload: Partial<Task> & { title: string }) {
    return withId(unwrap(await apiClient.post<ApiEnvelope<Task>>("/tasks", payload))) as Task;
  },
  async updateTask(id: string, payload: Partial<Task>) {
    return withId(unwrap(await apiClient.patch<ApiEnvelope<Task>>(`/tasks/${id}`, payload))) as Task;
  },
  async deleteTask(id: string) {
    return unwrap(await apiClient.delete<ApiEnvelope<{ id: string }>>(`/tasks/${id}`));
  },

  // --- analytics & system -------------------------------------------------
  async analytics() {
    return unwrap(await apiClient.get<ApiEnvelope<Analytics>>("/analytics"));
  },
  async systemStatus(includeBrowser = false) {
    return unwrap(await apiClient.get<ApiEnvelope<SystemStatus>>(`/system/status${includeBrowser ? "?browser=true" : ""}`));
  },
  async settings() {
    return unwrap(await apiClient.get<ApiEnvelope<Settings>>("/system/settings"));
  },
  async updateSettings(patch: Partial<Settings>) {
    return unwrap(await apiClient.patch<ApiEnvelope<Settings>>("/system/settings", patch));
  },
  async audioDevices() {
    return unwrap(await apiClient.get<ApiEnvelope<{ supported: boolean; devices: string[] }>>("/system/audio-devices"));
  },

  async testEmail(to?: string) {
    return unwrap(await apiClient.post<ApiEnvelope<EmailResult>>("/email/test", to ? { to } : {}));
  },
  async resetAi() {
    return unwrap(await apiClient.post<ApiEnvelope<unknown>>("/system/ai/reset", {}));
  },

  // --- RAG ----------------------------------------------------------------
  async ragSearch(query: string, meetingId?: string) {
    return unwrap(await apiClient.post<ApiEnvelope<{ query: string; results: RagHit[] }>>("/rag/search", { query, ...(meetingId ? { meetingId } : {}) }));
  },
  async ragAsk(question: string, meetingId?: string) {
    return unwrap(await apiClient.post<ApiEnvelope<RagAnswer>>("/rag/ask", { question, ...(meetingId ? { meetingId } : {}) }));
  },
  async ragDocuments() {
    return unwrap(await apiClient.get<ApiEnvelope<RagDocument[]>>("/rag/documents"));
  },
  async addRagDocument(payload: { title: string; text: string; type: RagDocument["type"] }) {
    return unwrap(await apiClient.post<ApiEnvelope<RagDocument>>("/rag/documents", payload));
  },
  async deleteRagDocument(id: string) {
    return unwrap(await apiClient.delete<ApiEnvelope<{ id: string }>>(`/rag/documents/${id}`));
  },
  async ragReindex() {
    return unwrap(await apiClient.post<ApiEnvelope<{ meetings: number; indexed: number; documents: number }>>("/rag/reindex", {}));
  },

  // --- integrations -------------------------------------------------------
  async gmailConnect() {
    return unwrap(await apiClient.post<ApiEnvelope<{ authUrl: string }>>("/integrations/gmail/connect", {}));
  },
  async gmailSync() {
    return unwrap(
      await apiClient.post<ApiEnvelope<{ skipped: boolean; created: number; updated: number; scanned: number }>>(
        "/integrations/gmail/sync",
        {}
      )
    );
  },
  async gmailDisconnect() {
    return unwrap(await apiClient.delete<ApiEnvelope<{ connected: boolean }>>("/integrations/gmail"));
  },
  async browserConnect() {
    return unwrap(await apiClient.post<ApiEnvelope<{ message: string; profileDir: string }>>("/integrations/browser/connect", {}));
  }
};
