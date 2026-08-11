# Allocation Tool: Assigned-QA Display & Weekly Spillover Scheduling — Design

## Context

Today, assigning a QA to a project means picking a start/end date and letting
the system compute one flat `days_per_week` rate for that whole range,
blocking submission if it would exceed the QA's capacity. This replaces that
with week-by-week scheduling: each week gets its own allocation row, capped
at whatever the QA actually has open that week, automatically continuing
into following weeks until the work is placed or the project's own deadline
is reached. Bulk Assign changes from splitting the total evenly across
selected QAs to scheduling each QA independently for the *full* remaining
total. A third, independent change adds a display of already-assigned QAs
once a project is picked.

## 1. Show already-assigned QAs

New action in `src/features/allocation-action.ts`:

```ts
export async function getAssignedQaNames(projectId: string): Promise<string[]>
```

Fetches the project's *approved* allocations, resolves each distinct
`user_id` to a profile name, returns the deduplicated name list. In
`allocation-form.tsx`, once a project is selected, a `useQuery` calls this
and renders a line under the project picker: `Already assigned: Delly Rizki
Saviolla, Fadli Robby` (or nothing, if the list is empty).

## 2. Weekly spillover scheduling (single-QA "Allocation Details" flow)

**Form changes** (`allocation-form.tsx`): the **End Date** field is removed.
The QA Lead/PM picks only a **Start Date** (still bounded to the selected
project's own `start_date`/`end_date` via `min`/`max`). The "This will
allocate ~X days/week" / over-capacity-blocks-submit UI is removed — nothing
can be blocked anymore, since each week is capped at what's actually
available. In its place, a short static note: *"Assigned days are scheduled
week by week at this QA's available capacity, continuing into future weeks
as needed."* "Remaining days for this item" stays as today.

**Schema**: a new `ScheduleAllocationInput` in `allocation-schema.ts`:

```ts
export const ScheduleAllocationInput = z.object({
  user_id: z.string().uuid("Select a tester"),
  project_id: z.string().uuid("Select a project"),
  role_on_project: z.string().trim().min(1, "Role on project is required"),
  start_date: isoDate,
  priority: z.enum(["low", "medium", "high", "critical"]),
});
```

No `days_per_week`, no `end_date` — both are now server-computed.
`AllocationInput` (used by `updateAllocation`/rebaseline) is untouched; this
is a parallel schema for the create flow only.

**`createAllocation` rewrite** (`allocation-action.ts`): parses
`ScheduleAllocationInput` instead of `AllocationInput`. Server
(re-)computes the project's remaining days itself — the same committed-vs-
total math `getRemainingProjectDays` already does, inlined with the `admin`
client (not a call to the exported cookie-scoped action, matching how
`createBulkAllocations` already inlines this same computation today rather
than calling `getRemainingProjectDays`) — then runs the scheduling loop
below once, returning `{ weeksCreated: number; placedDays: number;
unplacedDays: number }` instead of `{ success: true }`, so the UI can
report what actually happened (e.g. "Assigned across 3 weeks" or "Could
only place 8 of the 12 remaining days before the project's deadline").

**The scheduling loop** — a new internal helper:

```ts
async function scheduleWeeklyAllocations(params: {
  admin: AdminClient;
  userId: string;
  projectId: string;
  roleOnProject: string;
  priority: Priority;
  totalDays: number;
  startDateISO: string;
  projectEndDateISO: string;
  isLead: boolean;
  proposedBy: string | null;
}): Promise<{ weeksCreated: number; placedDays: number; unplacedDays: number }>
```

1. Fetch the user's existing *approved* allocations once, **before the loop
   starts** (`days_per_week, start_date, end_date`), excluding nothing (all
   other projects count against their capacity, same as today's capacity
   checks elsewhere). This snapshot deliberately does not include rows this
   same loop run creates for later weeks — since every row this loop
   creates is scoped to its own distinct week, none of them overlap any
   other week this same run schedules, so that's correct, not a staleness
   bug.
2. If `isLead`, call the existing `assertWithinParallelLimit` **once**,
   covering the QA's full intended span (`startDateISO` through
   `projectEndDateISO`) — every row this loop creates is for the same
   project, so it never adds more than one "parallel project" regardless of
   how many weekly rows result.
3. `remaining = totalDays`; `week = isoWeekRange(startDateISO)`.
4. While `remaining >= 0.5` and `week.start <= projectEndDateISO`:
   - `allocatedThisWeek = monthlyDaysForUser(existingAllocations, userId, week)`
     (the existing day-prorated helper, reused as-is for a single ISO week).
   - `weekCapacity = Math.max(0, profile.capacity_days - allocatedThisWeek)`.
   - `thisWeekDays = Math.min(remaining, Math.floor(weekCapacity * 2) / 2)`
     — **floored**, not rounded, to a half-day: this cap must never exceed
     the QA's true availability, even after quantizing to the app's
     half-day precision.
   - If `thisWeekDays >= 0.5`: insert one allocation row —
     `start_date = max(week.start, startDateISO)` (only the first week can
     start mid-week), `end_date = min(week.end, projectEndDateISO)`,
     `days_per_week: thisWeekDays`, `approval_status: isLead ? "approved" :
     "pending"`, `proposed_by: isLead ? null : proposedBy`. Increment
     `weeksCreated`, add `thisWeekDays` to `placedDays`, subtract from
     `remaining`.
   - Advance `week` to the following Monday–Sunday range.
5. Return `{ weeksCreated, placedDays, unplacedDays: remaining }` (already
   floored to 0 if fully placed).

The loop is naturally bounded by `projectEndDateISO` — every project has a
required `end_date`, so there's no risk of an unbounded loop even if a QA
has zero capacity for months.

## 3. Bulk Assign rework

`BulkAssignDialog` drops its per-QA-split preview and even-split framing.
Copy changes from *"Remaining working days are split evenly across the QA
members you select"* to *"Each selected QA is scheduled for the full
remaining workload at their own available capacity, spilling into future
weeks as needed."* The dialog title drops "(even split)". No other UI
changes — project picker (or `presetProject` display), tester checkboxes,
and role input stay as they are.

`createBulkAllocations` (`allocation-action.ts`) rewrite: still validates
the project is approved and has an `end_date`, still recomputes the
project's total remaining days server-side **once, before looping over
users** — every selected QA is scheduled against that same shared total (not
divided, not recomputed per user), matching "each gets the full remaining
workload" from Part 3 above. Instead of computing one shared `daysPerWeek`
and inserting one row per selected user, it calls
`scheduleWeeklyAllocations` **once per selected user**, each with that same
`remainingDays` total and the project's own `start_date`/`end_date` as the
schedule window. Partial success stays as today: one user's scheduling
failing (e.g. `assertWithinParallelLimit` rejecting them) doesn't block the
others. Return type changes from
`{ created: string[]; failed: { userId: string; reason: string }[] }` to:

```ts
{
  created: { userId: string; weeksCreated: number; placedDays: number; unplacedDays: number }[];
  failed: { userId: string; reason: string }[];
}
```

`failed` keeps its exact current shape. In `bulk-assign-dialog.tsx`'s
`onSuccess`, `result.created.length > 0` still works unchanged (still an
array); the success toast's wording changes from "Assigned N QA member(s)"
to something that reflects partial placement, e.g. listing how many of the
`created` entries have `unplacedDays > 0` and flagging those QAs by name
alongside the existing `failed` name-resolution logic (which is untouched).

## Out of scope

Rebaseline (`rebaseline-dialog.tsx`, `updateAllocation`,
`proposeAllocationChange`) is untouched — it continues to let a QA Lead or
PM directly set one flat `days_per_week` + date range on an existing
approved row, unchanged. No dry-run/preview of the exact week-by-week
schedule is shown before submitting — the existing "Remaining days for this
item" figure plus the static explanatory note are the only client-side
signal; the actual schedule is reported after submission via the success
toast. No changes to the DB schema — the existing `allocations` table
already supports multiple rows per `(user_id, project_id)` pair.
