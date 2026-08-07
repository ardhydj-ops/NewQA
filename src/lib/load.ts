export type DateRange = { start: string; end: string };

export type AllocationForCalc = {
  user_id: string;
  project_id: string;
  hours_per_week: number;
  start_date: string;
  end_date: string | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toUTCDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function formatISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Monday..Sunday range containing `date` (UTC). */
export function isoWeekRange(date: Date): DateRange {
  const day = date.getUTCDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: formatISODate(monday), end: formatISODate(sunday) };
}

/** First..last calendar day of the given month (0-indexed, UTC). */
export function monthRange(year: number, monthIndex0: number): DateRange {
  const first = new Date(Date.UTC(year, monthIndex0, 1));
  const last = new Date(Date.UTC(year, monthIndex0 + 1, 0));
  return { start: formatISODate(first), end: formatISODate(last) };
}

function overlapsRange(allocation: AllocationForCalc, range: DateRange): boolean {
  const allocEnd = allocation.end_date ?? range.end;
  return allocation.start_date <= range.end && allocEnd >= range.start;
}

/** Inclusive day count where `allocation` overlaps `range`; 0 if no overlap. */
function overlapDays(allocation: AllocationForCalc, range: DateRange): number {
  const allocEnd = allocation.end_date ?? range.end;
  const start = allocation.start_date > range.start ? allocation.start_date : range.start;
  const end = allocEnd < range.end ? allocEnd : range.end;
  if (start > end) return 0;
  return Math.round((toUTCDate(end).getTime() - toUTCDate(start).getTime()) / MS_PER_DAY) + 1;
}

export function weeklyHoursForUser(
  allocations: AllocationForCalc[],
  userId: string,
  week: DateRange,
): number {
  return allocations
    .filter((a) => a.user_id === userId && overlapsRange(a, week))
    .reduce((sum, a) => sum + a.hours_per_week, 0);
}

export function weeklyLoadPercent(allocatedHours: number, capacityHours: number): number {
  if (capacityHours <= 0) return 0;
  return (allocatedHours / capacityHours) * 100;
}

export type LoadStatus = "ok" | "warn" | "critical";

export function loadStatus(percent: number): LoadStatus {
  if (percent > 100) return "critical";
  if (percent >= 80) return "warn";
  return "ok";
}

/** Hours in `month`, prorated by day (hours_per_week / 7 * overlap days). */
export function monthlyHoursForUser(
  allocations: AllocationForCalc[],
  userId: string,
  month: DateRange,
): number {
  return allocations
    .filter((a) => a.user_id === userId)
    .reduce((sum, a) => sum + (a.hours_per_week / 7) * overlapDays(a, month), 0);
}

export function monthlyHoursForProject(
  allocations: AllocationForCalc[],
  projectId: string,
  month: DateRange,
): number {
  return allocations
    .filter((a) => a.project_id === projectId)
    .reduce((sum, a) => sum + (a.hours_per_week / 7) * overlapDays(a, month), 0);
}
