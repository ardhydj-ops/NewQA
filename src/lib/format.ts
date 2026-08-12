const dateFmt = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** For date-only strings (e.g. "2026-08-12") like project/allocation start_date, end_date. */
export function formatDate(iso: string): string {
  return dateFmt.format(new Date(`${iso}T00:00:00Z`));
}

/** For full timestamps (e.g. timestamptz columns like submitted_at, decided_at) that already include a time component. */
export function formatDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}
