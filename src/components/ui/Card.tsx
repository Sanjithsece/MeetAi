import { cn } from "@/utils/cn";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-lg border border-line bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900", className)}>
      {children}
    </section>
  );
}

export function CardHeader({ title, action, eyebrow }: { title: string; action?: React.ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        {eyebrow ? <p className="text-xs font-semibold uppercase tracking-wide text-teal">{eyebrow}</p> : null}
        <h2 className="text-lg font-bold text-ink dark:text-white">{title}</h2>
      </div>
      {action}
    </div>
  );
}
