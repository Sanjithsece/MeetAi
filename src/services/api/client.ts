import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";

/**
 * Talks to the local Express API only. In dev, Vite proxies /api to the
 * backend, so recordings stream from the same origin. No API key or secret is
 * ever held here - Gemini, SMTP and Notion credentials live only in the
 * backend's .env.
 */
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api/v1",
  // Local Whisper/Ollama work runs in the background, but some calls (opening
  // the Playwright browser, RAG answers from a local model) still take a while.
  timeout: 180000,
  headers: { "Content-Type": "application/json" }
});

export const TOKEN_KEY = "meetai_token";
export const REFRESH_KEY = "meetai_refresh_token";

/** Session hooks the AuthProvider registers so a dead session logs the UI out. */
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null) {
  onSessionExpired = handler;
}

apiClient.interceptors.request.use((config) => {
  // Only used when the server runs with AUTH_ENABLED=true.
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

/** One refresh at a time, shared by every request that hit a 401 together. */
async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return null;
  refreshing ??= axios
    .post(`${apiClient.defaults.baseURL}/auth/refresh`, { refreshToken })
    .then((response) => {
      const token = response.data?.data?.accessToken as string | undefined;
      if (token) localStorage.setItem(TOKEN_KEY, token);
      return token ?? null;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ message?: string; error?: { code?: string; message?: string } }>) => {
    if (error.code === "ERR_NETWORK") {
      return Promise.reject(new Error("Cannot reach the MeetAI API. Is the local server running (npm run dev)?"));
    }

    const config = error.config as RetriableConfig | undefined;
    const isAuthCall = config?.url?.includes("/auth/");
    if (error.response?.status === 401 && config && !config._retried && !isAuthCall && localStorage.getItem(REFRESH_KEY)) {
      config._retried = true;
      const token = await refreshAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        return apiClient(config);
      }
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
      onSessionExpired?.();
    }

    const body = error.response?.data;
    const message = body?.error?.message ?? body?.message ?? error.message ?? "Request failed";
    const wrapped = new Error(message) as Error & { code?: string; status?: number };
    wrapped.code = body?.error?.code;
    wrapped.status = error.response?.status;
    return Promise.reject(wrapped);
  }
);

/** Absolute URL of a local recording, for the <video> element. */
export function recordingUrl(meetingId: string) {
  const base = apiClient.defaults.baseURL ?? "/api/v1";
  return `${base}/meetings/${meetingId}/recording`;
}
