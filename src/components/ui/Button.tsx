import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/utils/cn";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  const variants = {
    primary: "bg-teal text-white hover:bg-teal/90",
    secondary: "border border-line bg-white text-ink hover:bg-mist dark:border-slate-700 dark:bg-slate-900 dark:text-white",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
    danger: "bg-rose text-white hover:bg-rose/90"
  };

  return (
    <button
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-teal/40 disabled:opacity-50",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
