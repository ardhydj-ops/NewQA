export type CalendarDay = { date: string; inCurrentMonth: boolean };
export type CalendarWeek = CalendarDay[];

function formatISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 6 rows x 7 cols (Mon-Sun) covering the full display grid for a month. */
export function buildCalendarGrid(year: number, monthIndex0: number): CalendarWeek[] {
  const firstOfMonth = new Date(Date.UTC(year, monthIndex0, 1));
  const firstWeekday = firstOfMonth.getUTCDay(); // 0 = Sunday
  const diffToMonday = firstWeekday === 0 ? -6 : 1 - firstWeekday;
  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(firstOfMonth.getUTCDate() + diffToMonday);

  const weeks: CalendarWeek[] = [];
  const cursor = new Date(gridStart);
  for (let w = 0; w < 6; w++) {
    const week: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({ date: formatISODate(cursor), inCurrentMonth: cursor.getUTCMonth() === monthIndex0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export type CalendarBar = {
  projectId: string;
  startCol: number; // 0-6 within the week
  endCol: number; // 0-6 within the week, inclusive
  lane: number;
};

/**
 * Greedy interval-packing for one week: clips each project's range to the
 * week's [start,end], converts to 0-6 day-of-week columns, and assigns each
 * segment to the lowest lane whose previously-placed segment doesn't overlap
 * it — the standard "calendar event stacking" algorithm.
 */
export function packWeekBars(
  week: CalendarWeek,
  projects: { id: string; start_date: string; end_date: string | null }[],
): CalendarBar[] {
  const weekStart = week[0].date;
  const weekEnd = week[6].date;

  const segments = projects
    .filter((p) => p.start_date <= weekEnd && (p.end_date === null || p.end_date >= weekStart))
    .map((p) => {
      const segStart = p.start_date > weekStart ? p.start_date : weekStart;
      const segEndRaw = p.end_date === null || p.end_date > weekEnd ? weekEnd : p.end_date;
      const startCol = week.findIndex((d) => d.date === segStart);
      const endCol = week.findIndex((d) => d.date === segEndRaw);
      return { projectId: p.id, startCol, endCol };
    })
    .sort((a, b) => a.startCol - b.startCol || a.endCol - b.endCol);

  const laneEndCols: number[] = [];
  const bars: CalendarBar[] = [];
  for (const seg of segments) {
    let lane = laneEndCols.findIndex((endCol) => endCol < seg.startCol);
    if (lane === -1) {
      lane = laneEndCols.length;
      laneEndCols.push(seg.endCol);
    } else {
      laneEndCols[lane] = seg.endCol;
    }
    bars.push({ ...seg, lane });
  }
  return bars;
}
