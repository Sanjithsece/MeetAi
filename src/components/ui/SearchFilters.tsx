import { FaFilter, FaMagnifyingGlass } from "react-icons/fa6";

export function SearchFilters({
  placeholder = "Search MeetAI records",
  filters = ["All", "Verified", "Submitted", "This month"]
}: {
  placeholder?: string;
  filters?: string[];
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <label className="relative w-full sm:max-w-md">
        <FaMagnifyingGlass className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="h-11 w-full rounded-md border border-line bg-white pl-10 pr-4 text-sm outline-none focus:border-teal dark:border-slate-700 dark:bg-slate-900"
          placeholder={placeholder}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {filters.map((filter) => (
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-slate-600 hover:bg-mist dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            key={filter}
          >
            <FaFilter className="h-3 w-3" />
            {filter}
          </button>
        ))}
      </div>
    </div>
  );
}
