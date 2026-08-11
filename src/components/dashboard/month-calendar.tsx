"use client";

import { buildCalendarGrid, packWeekBars } from "@/lib/calendar";
import { formatDate } from "@/lib/format";
import type { Project } from "@/lib/project";

const MAX_LANES = 3;
const BAR_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-pink-500",
  "bg-lime-600",
];

function colorForProject(projectId: string): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) hash = (hash + projectId.charCodeAt(i)) % BAR_COLORS.length;
  return BAR_COLORS[hash];
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type MonthCalendarProps = {
  year: number;
  monthIndex0: number;
  projects: Project[];
};

export function MonthCalendar({ year, monthIndex0, projects }: MonthCalendarProps) {
  const weeks = buildCalendarGrid(year, monthIndex0);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const rowTemplate = `1.5rem repeat(${MAX_LANES}, 1.25rem) 1rem`;

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="grid grid-cols-7 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-2 py-1.5">
            {label}
          </div>
        ))}
      </div>

      {weeks.map((week, weekIndex) => {
        const bars = packWeekBars(week, projects);
        const visibleBars = bars.filter((b) => b.lane < MAX_LANES);
        const hiddenCount = bars.length - visibleBars.length;

        return (
          <div
            key={weekIndex}
            className="relative grid grid-cols-7 border-b last:border-b-0"
            style={{ gridTemplateRows: rowTemplate }}
          >
            {week.map((_, dayIndex) => (
              <div
                key={`border-${dayIndex}`}
                className="border-r last:border-r-0"
                style={{ gridColumn: dayIndex + 1, gridRow: "1 / -1" }}
              />
            ))}

            {week.map((day, dayIndex) => (
              <div
                key={day.date}
                className={`px-1.5 pt-1 text-xs ${day.inCurrentMonth ? "" : "text-muted-foreground/40"}`}
                style={{ gridColumn: dayIndex + 1, gridRow: 1 }}
              >
                {Number(day.date.slice(8, 10))}
              </div>
            ))}

            {visibleBars.map((bar) => {
              const project = projectById.get(bar.projectId);
              if (!project) return null;
              return (
                <div
                  key={bar.projectId}
                  title={`${project.name} (${formatDate(project.start_date)} – ${
                    project.end_date ? formatDate(project.end_date) : "Ongoing"
                  })`}
                  className={`mx-0.5 mt-0.5 truncate rounded px-1 text-[10px] leading-4 text-white ${colorForProject(bar.projectId)}`}
                  style={{ gridColumn: `${bar.startCol + 1} / ${bar.endCol + 2}`, gridRow: bar.lane + 2 }}
                >
                  {project.name}
                </div>
              );
            })}

            {hiddenCount > 0 && (
              <div
                className="col-span-7 px-1.5 text-[10px] text-muted-foreground"
                style={{ gridColumn: "1 / -1", gridRow: MAX_LANES + 2 }}
              >
                +{hiddenCount} more
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
