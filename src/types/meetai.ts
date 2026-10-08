export type MeetingStatus =
  | "UPCOMING"
  | "JOINING"
  | "RECORDING"
  | "RECORDING_COMPLETED"
  | "RECORDING_FAILED"
  | "TRANSCRIBING"
  | "ANALYZING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type StepStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
export type StageState = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "RETRYING" | "SKIPPED";
export type StageName = "join" | "recording" | "transcription" | "analysis" | "rag" | "notion" | "email";
export type MeetingSource = "MANUAL" | "GMAIL" | "GOOGLE_CALENDAR" | "IMPORT";

export type Participant = {
  name?: string;
  email?: string;
  role?: "ORGANIZER" | "ATTENDEE";
};

export type ActionItem = {
  task: string;
  person?: string;
  deadline?: string;
  priority: Priority;
};

export type Meeting = {
  id: string;
  title: string;
  description?: string;
  meetingUrl?: string;
  date?: string;
  startTime: string;
  endTime?: string;
  durationMinutes?: number | null;
  participants: Participant[];
  source: MeetingSource;
  status: MeetingStatus;
  priority: Priority;
  tags: string[];
  notes?: string;
  recording?: {
    filePath?: string;
    format?: string;
    durationSeconds?: number;
    sizeBytes?: number;
    recordedAt?: string;
    recorder?: string;
    error?: string;
  };
  transcript?: {
    filePath?: string;
    status: StepStatus;
    engine?: string;
    language?: string;
    wordCount?: number;
    generatedAt?: string;
    error?: string;
  };
  aiAnalysis?: {
    status: StepStatus;
    provider?: string;
    model?: string;
    title?: string;
    shortSummary?: string;
    summary?: string;
    keyPoints?: string[];
    questions?: string[];
    followUps?: string[];
    meetingStatus?: string;
    chunked?: boolean;
    attempts?: Array<{ provider: string; outcome: string; kind?: string; message?: string }>;
    importantTopics: string[];
    decisions: string[];
    actionItems: ActionItem[];
    deadlines: Array<{ label?: string; date?: string; person?: string }>;
    peopleResponsible: string[];
    sentiment?: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "MIXED";
    priority?: Priority;
    generatedAt?: string;
    error?: string;
  };
  notion?: { pageId?: string; pageUrl?: string; createdAt?: string; error?: string };
  rag?: { status: "PENDING" | "COMPLETED" | "FAILED" | "SKIPPED"; chunks?: number; store?: string; indexedAt?: string; error?: string };
  email?: { status: "PENDING" | "SENT" | "FAILED" | "SKIPPED"; to?: string; sentAt?: string; error?: string };
  stages?: Partial<Record<StageName, { status: StageState; updatedAt?: string; detail?: string }>>;
  automation?: {
    autoJoin: boolean;
    autoRecord: boolean;
    autoProcess: boolean;
    joinedAt?: string;
    leftAt?: string;
    lastError?: string;
  };
  statusHistory?: Array<{ status: string; at: string; detail?: string }>;
  createdAt: string;
  updatedAt: string;
};

export type ProcessingJob = {
  id: string;
  meeting: string;
  type: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  step?: string;
  progress: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
};

export type MeetingDetail = {
  meeting: Meeting;
  tasks: Task[];
  job: ProcessingJob | null;
  live: { joined: boolean; recording: boolean; joining?: boolean };
  files: { recording: boolean; transcript: boolean; notes: boolean };
};

export type Task = {
  id: string;
  meeting?: string;
  title: string;
  description?: string;
  assigneeName?: string;
  assigneeEmail?: string;
  deadline?: string;
  priority: Priority;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  aiGenerated: boolean;
  completedAt?: string;
  createdAt: string;
};

export type Analytics = {
  totalMeetings: number;
  recordedMeetings: number;
  analyzedMeetings: number;
  totalMeetingHours: number;
  totalRecordingHours: number;
  averageMeetingDuration: number;
  pendingTasks: number;
  completedTasks: number;
  overdueTasks: number;
  byMonth: Array<{ month: string; meetings: number; recorded: number }>;
  statusBreakdown: Record<string, number>;
};

export type HealthEntry = {
  available?: boolean;
  connected?: boolean;
  configured?: boolean;
  message: string;
};

export type SystemStatus = {
  mongodb: HealthEntry & { state: string; uri: string };
  ollama: HealthEntry & { url: string; model: string; modelReady?: boolean; models?: string[]; isDefaultProvider: boolean };
  gemini: HealthEntry & {
    enabled: boolean;
    configured: boolean;
    model?: string;
    keys?: Array<{ label: string; model: string; skipped: string | null; state: { kind?: string; disabled?: boolean } | null }>;
  };
  aiProvider: string;
  cloudFallback?: boolean;
  rag?: HealthEntry & { enabled: boolean; store: string; chunks: number | null; documents: number; embeddingModel: string; allowCloud: boolean };
  email?: HealthEntry & { host?: string; defaultRecipient?: boolean };
  whisper: HealthEntry & { implementation: string | null };
  recorder: HealthEntry & {
    mode: string;
    audioDevice: string | null;
    audioReady: boolean;
    requirements: string;
    ffmpeg: HealthEntry & { version?: string };
  };
  ffmpeg: HealthEntry & { version?: string };
  notion: HealthEntry;
  gmail: HealthEntry & { emailAddress?: string };
  browserProfile?: HealthEntry & { signedIn: boolean; profileDir: string };
  scheduler: { running: boolean; gmailSyncRunning: boolean; attemptedThisRun: number };
  jobs: { queued: number };
  offline: { worksOffline: string[]; needsInternet: string[] };
};

export type Settings = {
  aiProvider: "auto" | "ollama" | "gemini";
  ollamaUrl: string;
  ollamaModel: string;
  whisperImplementation: string;
  whisperModel: string;
  whisperLanguage: string;
  joinOffsetMinutes: number;
  schedulerEnabled: boolean;
  autoProcessAfterRecording: boolean;
  createTasksFromActionItems: boolean;
  recorderAudioDevice: string;
  meetingDisplayName: string;
  joinRetries: number;
  joinRetryDelaySeconds: number;
  lobbyMaxMinutes: number;
  geminiConfigured: boolean;
  geminiKeyCount: number;
  geminiModel: string;
  cloudFallback: boolean;
  embeddingModel: string;
  ragEnabled: boolean;
  ragStore: string;
  ragAllowCloud: boolean;
  emailConfigured: boolean;
  emailDefaultRecipient: boolean;
  notionConfigured: boolean;
  gmailConfigured: boolean;
  recordingDir: string;
  transcriptDir: string;
  meetingNotesDir: string;
  browserProfileDir: string;
  authEnabled: boolean;
  recorderMaxMinutes: number;
};

export type MeetingListQuery = {
  scope?: "today" | "upcoming" | "previous" | "recorded";
  status?: string;
  priority?: string;
  source?: string;
  search?: string;
  from?: string;
  to?: string;
  sort?: "newest" | "oldest" | "title" | "priority";
  page?: number;
  limit?: number;
};

export type Paginated<T> = {
  items: T[];
  meta: { page: number; limit: number; total: number; pages: number };
};

export type MeetingInput = {
  title: string;
  description?: string;
  meetingUrl?: string;
  startTime: string;
  endTime?: string;
  participants?: Participant[];
  priority: Priority;
  notes?: string;
};

export type ActivityEntry = {
  _id: string;
  meeting?: string;
  meetingTitle?: string;
  stage: StageName | "meeting" | "system";
  status: StageState | "INFO";
  message: string;
  createdAt: string;
};

export type RagHit = {
  id: string;
  text: string;
  score: number;
  sourceType: string;
  sourceId: string;
  meetingId?: string;
  meetingTitle?: string;
  date?: string;
};

export type RagAnswer = { answer: string; sources: RagHit[]; provider: string | null; model: string | null };

export type RagDocument = {
  _id: string;
  title: string;
  type: "document" | "note" | "preference" | "profile";
  characters: number;
  chunks?: number;
  indexedAt?: string;
  error?: string;
  createdAt: string;
};

export type EmailResult = { status: "SENT" | "FAILED" | "SKIPPED"; messageId?: string; error?: string };
