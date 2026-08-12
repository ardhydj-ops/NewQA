# QA-Filtered Month Calendar — Design

## Context

The Dashboard's "Ongoing Projects This Month" card (`MonthCalendar`) currently
shows every approved project whose date range overlaps the selected month,
regardless of who's assigned. There's no way to answer "what is this
specific tester working on this month?" without opening each project's
assignment list individually. This adds an opt-in multi-select QA filter
above the calendar that narrows the bars to only projects with an approved
allocation for one or more selected testers.

Scope is intentionally narrow: this only touches the month calendar card.
The weekly summary cards, "Capacity by QA Group", and the two pie charts are
unaffected.

## 1. Data layer

New server action in `src/features/dashboard-action.ts`:

```ts
/** project_id -> distinct user_ids with an approved allocation overlapping the month. */
export async function getMonthAllocationAssignments(
  year: number,
  monthIndex0: number,
): Promise<Record<string, string[]>> {
  const month = monthRange(year, monthIndex0);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("allocations")
    .select("project_id, user_id")
    .eq("approval_status", "approved")
    .lte("start_date", month.end)
    .or(`end_date.is.null,end_date.gte.${month.start}`);
  if (error) throw new Error(error.message);

  const map: Record<string, string[]> = {};
  for (const row of data ?? []) {
    const users = (map[row.project_id] ??= []);
    if (!users.includes(row.user_id)) users.push(row.user_id);
  }
  return map;
}
```

Same overlap logic as the existing `getProjectsForMonth` (line up with it so
"ongoing this month" means the same date window in both places). The QA
picker's option list reuses the existing `getAssignableProfiles()` action
(`src/features/profile-action.ts`) — active `qa_lead`/`qa_member` only, same
convention as every other assignee picker in the app (e.g. the bulk-assign
dialog). No new action needed for that list.

## 2. Client state & filtering

In `DashboardPageContent` (`src/components/dashboard/dashboard-page-content.tsx`):

- New state: `const [selectedQaIds, setSelectedQaIds] = useState<string[]>([])`.
- New query: `["month-allocation-assignments", year, monthIndex0]` →
  `getMonthAllocationAssignments(year, monthIndex0)`.
- New query: `["assignable-profiles"]` → `getAssignableProfiles()` (shares
  its cache with `bulk-assign-dialog.tsx`, which already uses this exact key).
- Derived list, computed with `useMemo` off `monthProjects`,
  `monthAssignments`, and `selectedQaIds`:

  ```ts
  const visibleMonthProjects = useMemo(() => {
    if (selectedQaIds.length === 0) return monthProjects ?? [];
    return (monthProjects ?? []).filter((p) =>
      (monthAssignments?.[p.id] ?? []).some((userId) => selectedQaIds.includes(userId)),
    );
  }, [monthProjects, monthAssignments, selectedQaIds]);
  ```

- `selectedQaIds` is not reset when `year`/`monthIndex0` change — a filter
  picked for August stays applied when you page to September.
- `<MonthCalendar projects={monthProjects ?? []} />` becomes
  `<MonthCalendar projects={visibleMonthProjects} />`.

## 3. UI

New component, `src/components/dashboard/qa-month-filter.tsx`:

- A `Popover` (trigger button + `PopoverContent`) containing a `Command`
  with `CommandInput` (search-by-name) and one `CommandItem` per assignable
  profile, each toggling membership in `selectedQaIds` and rendering a
  check mark when selected — same building blocks as the existing project
  combobox in `allocation-form.tsx`, applied as a multi-select instead of
  single-select.
- Trigger button label: `"Filter by QA"` when `selectedQaIds` is empty,
  `"{n} QAs selected"` otherwise.
- A small `"Clear"` text button sits next to the trigger button (outside
  the popover, so it's reachable without opening it) and resets
  `selectedQaIds` to `[]`. It only renders when `selectedQaIds` is non-empty.
- Placement: inline with the existing `"Month"` label/date input row, to
  the right of it, so it reads as scoped to the calendar card directly
  below.

Props: `{ profiles: Profile[]; selectedQaIds: string[]; onChange: (ids: string[]) => void }`
— purely controlled, no internal query of its own, so it stays easy to
reason about and test in isolation from data fetching.

## 4. Empty state

When `selectedQaIds.length > 0` and `visibleMonthProjects.length === 0`
(projects exist for the month, but none match the filter), render a small
`"No ongoing projects for the selected QA(s) this month."` message in place
of the calendar grid, so a narrowed-to-nothing filter reads as a filter
result, not a loading or error state.

## 5. Edge cases

- **Deactivated testers**: not returned by `getAssignableProfiles`, so they
  can't be picked as a filter option. A project staffed only by someone
  since deactivated still shows up in the unfiltered view — consistent with
  every other "active users only" picker in the app.
- **No persistence**: `selectedQaIds` is local component state. A page
  reload clears it, same as the existing `weekStart`/`year`/`monthIndex0`
  state resets to "today" on reload.
- **Multiple QAs on the same project**: the project shows once (a `some()`
  match, not a count) — this is a project filter, not a per-QA duplicate-bar
  view.

## 6. Testing

No automated test suite exists in this repo yet. Verification is manual:
run the dev server, exercise the filter against real data (single QA,
multiple QAs, a QA with nothing this month, clearing the filter, switching
months with a filter active), and confirm `tsc --noEmit` stays clean —
consistent with how the rest of the app is currently verified.
