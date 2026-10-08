import { Link } from "react-router-dom";
import { FaMoon, FaSun, FaCircleDot } from "react-icons/fa6";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useSystemStatus } from "@/services/queries";
import { cn } from "@/utils/cn";

/** Compact health pill: the three services the app cannot work without. */
function LocalStackPill() {
  const { data } = useSystemStatus();
  if (!data) return null;

  const services = [
    { label: "MongoDB", ok: data.mongodb.available },
    { label: "Ollama", ok: Boolean(data.ollama.available && data.ollama.modelReady) },
    { label: "Whisper", ok: Boolean(data.whisper.available) }
  ];

  return (
    <Link
      to="/settings"
      className="hidden items-center gap-3 rounded-md border border-line px-3 py-2 text-xs font-semibold dark:border-slate-800 md:flex"
      title="Local service status - open Settings for details"
    >
      {services.map((service) => (
        <span key={service.label} className="flex items-center gap-1.5">
          <FaCircleDot className={cn("h-2.5 w-2.5", service.ok ? "text-teal" : "text-slate-400")} />
          <span className={service.ok ? "text-ink dark:text-white" : "text-slate-400"}>{service.label}</span>
        </span>
      ))}
    </Link>
  );
}

export function Topbar() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
      <div className="flex min-h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div>
          <p className="text-xs font-semibold uppercase text-teal">Local workspace</p>
          <h1 className="text-lg font-bold text-ink dark:text-white">
            {user?.name ? `Welcome back, ${user.name}` : "MeetAI"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <LocalStackPill />
          <Button variant="ghost" className="h-10 w-10 p-0" onClick={toggleTheme} aria-label="Toggle dark mode">
            {theme === "dark" ? <FaSun /> : <FaMoon />}
          </Button>
        </div>
      </div>
    </header>
  );
}
