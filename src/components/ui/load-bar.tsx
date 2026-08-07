import { cn } from "@/lib/utils";
import { loadStatus, type LoadStatus } from "@/lib/load";

const FILL_CLASS: Record<LoadStatus, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  critical: "bg-rose-600",
};

const TEXT_CLASS: Record<LoadStatus, string> = {
  ok: "text-emerald-700",
  warn: "text-amber-700",
  critical: "text-rose-700",
};

type LoadBarProps = {
  percent: number;
  className?: string;
};

export function LoadBar({ percent, className }: LoadBarProps) {
  const status = loadStatus(percent);
  const width = Math.min(100, Math.max(0, percent));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-2 flex-1 rounded-full bg-slate-200">
        <div className={cn("h-2 rounded-full", FILL_CLASS[status])} style={{ width: `${width}%` }} />
      </div>
      <span className={cn("w-12 text-right text-sm font-semibold tabular-nums", TEXT_CLASS[status])}>
        {Math.round(percent)}%
      </span>
    </div>
  );
}
