import type { IconType } from "react-icons";
import { Card } from "@/components/ui/Card";
import { cn } from "@/utils/cn";

export function StatCard({
  label,
  value,
  change,
  icon: Icon,
  intent = "neutral"
}: {
  label: string;
  value: string | number;
  change: string;
  icon: IconType;
  intent?: "positive" | "warning" | "neutral";
}) {
  const intentClass = {
    positive: "text-teal bg-teal/10",
    warning: "text-amber bg-amber/10",
    neutral: "text-indigo bg-indigo/10"
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-2 text-2xl font-bold text-ink dark:text-white">{value}</p>
        </div>
        <span className={cn("rounded-md p-2", intentClass[intent])}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-4 text-xs font-medium text-slate-500 dark:text-slate-400">{change}</p>
    </Card>
  );
}
