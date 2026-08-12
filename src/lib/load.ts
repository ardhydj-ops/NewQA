export type DateRange = { start: string; end: string };

export type AllocationForCalc = {
  user_id: string;
  project_id: string;
  days_per_week: number;
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

export function weeklyDaysForUser(
  allocations: AllocationForCalc[],
  userId: string,
  week: DateRange,
): number {
  return allocations
    .filter((a) => a.user_id === userId && overlapsRange(a, week))
    .reduce((sum, a) => sum + a.days_per_week, 0);
}

export function weeklyLoadPercent(allocatedDays: number, capacityDays: number): number {
  if (capacityDays <= 0) return 0;
  return (allocatedDays / capacityDays) * 100;
}

export type LoadStatus = "ok" | "warn" | "critical";

export function loadStatus(percent: number): LoadStatus {
  if (percent > 100) return "critical";
  if (percent >= 80) return "warn";
  return "ok";
}

/** Days in `month`, prorated by day (days_per_week / 7 * overlap days). */
export function monthlyDaysForUser(
  allocations: AllocationForCalc[],
  userId: string,
  month: DateRange,
): number {
  return allocations
    .filter((a) => a.user_id === userId)
    .reduce((sum, a) => sum + (a.days_per_week / 7) * overlapDays(a, month), 0);
}

export function monthlyDaysForProject(
  allocations: AllocationForCalc[],
  projectId: string,
  month: DateRange,
): number {
  return allocations
    .filter((a) => a.project_id === projectId)
    .reduce((sum, a) => sum + (a.days_per_week / 7) * overlapDays(a, month), 0);
}

/** Inclusive weeks spanned by [startDate, endDate]; always at least 1. */
export function weeksBetween(startDate: string, endDate: string): number {
  const days = Math.round((toUTCDate(endDate).getTime() - toUTCDate(startDate).getTime()) / MS_PER_DAY) + 1;
  return Math.max(1, days / 7);
}

/** Count of Mon-Fri calendar days in [startDate, endDate], inclusive. */
export function weekdaysBetween(startDate: string, endDate: string): number {
  let count = 0;
  for (let d = toUTCDate(startDate); d <= toUTCDate(endDate); d = new Date(d.getTime() + MS_PER_DAY)) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

export type DatedRange = { start_date: string; end_date: string | null };

/** Open-ended-aware overlap test for two arbitrary date intervals (not a fixed week/month). */
export function rangesOverlap(a: DatedRange, b: DatedRange): boolean {
  const aEnd = a.end_date ?? "9999-12-31";
  const bEnd = b.end_date ?? "9999-12-31";
  return a.start_date <= bEnd && b.start_date <= aEnd;
}

export type AllocationForOverlapCalc = DatedRange & { user_id: string; project_id: string };

/**
 * Distinct projects a user has an allocation on that overlaps `candidate`.
 * `excludeProjectId` avoids double-counting the same project the candidate
 * itself belongs to (e.g. two roles on one project shouldn't count as 2).
 */
export function overlappingProjectCount(
  allocations: AllocationForOverlapCalc[],
  userId: string,
  candidate: DatedRange,
  excludeProjectId?: string,
): number {
  const projectIds = new Set(
    allocations
      .filter((a) => a.user_id === userId && a.project_id !== excludeProjectId && rangesOverlap(a, candidate))
      .map((a) => a.project_id),
  );
  return projectIds.size;
}
