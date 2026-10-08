import { Link } from "react-router-dom";
import { FaArrowRight, FaBrain } from "react-icons/fa6";
import { Button } from "@/components/ui/Button";

export function PublicNavbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-3 font-bold">
          <span className="grid h-10 w-10 place-items-center rounded-md bg-teal text-white">
            <FaBrain />
          </span>
          <span>MeetAI</span>
        </Link>
        <p className="hidden text-sm font-medium text-slate-500 dark:text-slate-400 md:block">
          Local-first meeting assistant
        </p>
        <div className="flex items-center gap-2">
          <Link to="/login">
            <Button variant="ghost">Login</Button>
          </Link>
          <Link to="/register">
            <Button>
              Register <FaArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </nav>
    </header>
  );
}
