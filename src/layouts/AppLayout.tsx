import { Outlet } from "react-router-dom";
import { MobileNav, Sidebar } from "@/components/navigation/Sidebar";
import { Topbar } from "@/components/navigation/Topbar";

export function AppLayout() {
  return (
    <div className="min-h-screen bg-mist dark:bg-slate-950">
      <Sidebar />
      <div className="lg:pl-64">
        <Topbar />
        <MobileNav />
        <main className="px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
