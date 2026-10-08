import { Outlet } from "react-router-dom";
import { PublicNavbar } from "@/components/navigation/PublicNavbar";

export function PublicLayout() {
  return (
    <div className="min-h-screen bg-mist text-ink dark:bg-slate-950 dark:text-white">
      <PublicNavbar />
      <Outlet />
    </div>
  );
}
