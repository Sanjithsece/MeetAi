import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

/**
 * In local single-user mode the server always resolves an owner, so this simply
 * waits for the bootstrap call. It only redirects to /login when the API
 * actually rejects the session (AUTH_ENABLED=true without a token).
 */
export function ProtectedRoute() {
  const { isAuthenticated, isLoading, error } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-mist dark:bg-slate-950">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-teal border-t-transparent" />
          <p className="mt-4 text-sm font-semibold text-slate-500">Connecting to your local MeetAI server...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location, reason: error }} />;
  }

  return <Outlet />;
}
