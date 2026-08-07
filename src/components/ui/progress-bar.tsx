import { cn } from "@/lib/utils";

type ProgressBarProps = {
  percent: number;
  className?: string;
};

export function ProgressBar({ percent, className }: ProgressBarProps) {
  const width = Math.min(100, Math.max(0, percent));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-2 w-24 rounded-full bg-slate-200">
        <div className="h-2 rounded-full bg-blue-600" style={{ width: `${width}%` }} />
      </div>
      <span className="w-10 text-right text-sm tabular-nums text-slate-600">{Math.round(width)}%</span>
    </div>
  );
}
