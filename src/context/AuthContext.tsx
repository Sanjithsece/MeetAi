import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { REFRESH_KEY, setSessionExpiredHandler, TOKEN_KEY } from "@/services/api/client";
import { meetaiApi } from "@/services/api/meetaiApi";
import type { AuthSession, AuthUser, LoginCredentials, RegisterPayload } from "@/types/auth";

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * MeetAI normally runs as a personal single-user app: the server resolves the
 * local workspace owner itself, so the UI just asks `/auth/me` on boot and never
 * shows a login screen. When the server runs with AUTH_ENABLED=true the stored
 * JWT is used instead and the login pages take over.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A refresh that fails (expired/revoked session) drops the user back to /login.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setToken(null);
      setUser(null);
      setError("Your session expired. Please sign in again.");
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    meetaiApi
      .me()
      .then((profile) => {
        if (!cancelled) setUser(profile);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const persist = (session: AuthSession) => {
    localStorage.setItem(TOKEN_KEY, session.token);
    if (session.refreshToken) localStorage.setItem(REFRESH_KEY, session.refreshToken);
    setToken(session.token);
    setUser(session.user);
    setError(null);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(user),
      isLoading,
      error,
      login: async (credentials) => persist(await meetaiApi.login(credentials)),
      register: async (payload) => persist(await meetaiApi.register(payload)),
      logout: () => {
        // Revoke the refresh token server-side (best effort), then forget both tokens.
        void meetaiApi.logout();
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_KEY);
        setToken(null);
        setUser(null);
      }
    }),
    [error, isLoading, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
