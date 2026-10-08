import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/layouts/AppLayout";
import { PublicLayout } from "@/layouts/PublicLayout";
import { ProtectedRoute } from "@/router/ProtectedRoute";
import { LoginPage } from "@/pages/auth/LoginPage";
import { RegisterPage } from "@/pages/auth/RegisterPage";
import { DashboardPage } from "@/pages/app/DashboardPage";
import { MeetingsPage } from "@/pages/app/MeetingsPage";
import { MeetingDetailsPage } from "@/pages/app/MeetingDetailsPage";
import { TasksPage } from "@/pages/app/TasksPage";
import { RecordingsPage } from "@/pages/app/RecordingsPage";
import { AnalyticsPage } from "@/pages/app/AnalyticsPage";
import { SettingsPage } from "@/pages/app/SettingsPage";
import { KnowledgePage } from "@/pages/app/KnowledgePage";

export function AppRouter() {
  return (
    <Routes>
      {/* Only reachable when the server runs with AUTH_ENABLED=true. */}
      <Route element={<PublicLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/meetings" element={<MeetingsPage />} />
          <Route path="/meetings/:id" element={<MeetingDetailsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/recordings" element={<RecordingsPage />} />
          <Route path="/ask" element={<KnowledgePage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
