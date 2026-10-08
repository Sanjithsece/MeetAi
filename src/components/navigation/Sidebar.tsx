import { NavLink } from "react-router-dom";
import { FaBrain, FaChartLine, FaGear, FaListCheck, FaMagnifyingGlass, FaRegClock, FaTableColumns, FaVideo } from "react-icons/fa6";
import { cn } from "@/utils/cn";

const navItems = [
  { to: "/", label: "Dashboard", icon: FaTableColumns, end: true },
  { to: "/meetings", label: "Meetings", icon: FaRegClock },
  { to: "/tasks", label: "Tasks", icon: FaListCheck },
  { to: "/recordings", label: "Recordings", icon: FaVideo },
  { to: "/ask", label: "Ask meetings", icon: FaMagnifyingGlass },
  { to: "/analytics", label: "Analytics", icon: FaChartLine },
  { to: "/settings", label: "Settings", icon: FaGear }
];

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-line bg-white px-4 py-5 dark:border-slate-800 dark:bg-slate-950 lg:block">
      <div className="flex items-center gap-3 px-2">
        <span className="grid h-10 w-10 place-items-center rounded-md bg-teal text-white">
          <FaBrain />
        </span>
        <div>
          <p className="font-bold text-ink dark:text-white">MeetAI</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Runs on this computer</p>
        </div>
      </div>

      <nav className="mt-8 space-y-1">
        {navItems.map((item) => (
          <NavLink
            to={item.to}
            key={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition",
                isActive ? "bg-teal text-white" : "text-slate-600 hover:bg-mist dark:text-slate-300 dark:hover:bg-slate-900"
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

/** Compact bar shown instead of the sidebar on small screens. */
export function MobileNav() {
  return (
    <nav className="sticky top-16 z-20 flex gap-1 overflow-x-auto border-b border-line bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950 lg:hidden">
      {navItems.map((item) => (
        <NavLink
          to={item.to}
          key={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              "whitespace-nowrap rounded-md px-3 py-2 text-xs font-semibold",
              isActive ? "bg-teal text-white" : "text-slate-600 dark:text-slate-300"
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
