# Convert Hours to Days — Design

## Context

Every capacity/allocation/budget number in the app is currently denominated in
hours: a QA's weekly capacity (`profiles.capacity_hours`), how much of a QA's
week an assignment consumes (`allocations.hours_per_week` /
`proposed_hours_per_week`), and a project's total effort budget
(`projects.total_working_hours`). The team wants to work in **days** instead,
throughout — inputs, storage, and every derived calculation, not just display
labels.

## 1. Data model & migration

One migration, `supabase/migrations/0005_qa_resource_manager_v5.sql`, renames
and transforms three columns in place (8 hours = 1 day):

```sql
alter table public.profiles rename column capacity_hours to capacity_days;
update public.profiles set capacity_days = round(capacity_days / 8 * 2) / 2;
alter table public.profiles alter column capacity_days set default 5;
alter table public.profiles drop constraint if exists profiles_capacity_hours_check;
alter table public.profiles add constraint profiles_capacity_days_check
  check (capacity_days > 0 and capacity_days = round(capacity_days * 2) / 2);

alter table public.allocations rename column hours_per_week to days_per_week;
update public.allocations set days_per_week = round(days_per_week / 8 * 2) / 2;
alter table public.allocations drop constraint if exists allocations_hours_per_week_check;
alter table public.allocations add constraint allocations_days_per_week_check
  check (days_per_week > 0 and days_per_week = round(days_per_week * 2) / 2);

alter table public.allocations rename column proposed_hours_per_week to proposed_days_per_week;
update public.allocations set proposed_days_per_week = round(proposed_days_per_week / 8 * 2) / 2
  where proposed_days_per_week is not null;
alter table public.allocations drop constraint if exists allocations_proposed_hours_per_week_check;
alter table public.allocations add constraint allocations_proposed_days_per_week_check
  check (proposed_days_per_week is null or
    (proposed_days_per_week > 0 and proposed_days_per_week = round(proposed_days_per_week * 2) / 2));

alter table public.projects rename column total_working_hours to total_working_days;
update public.projects set total_working_days = round(total_working_days / 8 * 2) / 2;
alter table public.projects drop constraint if exists projects_total_working_hours_check;
alter table public.projects add constraint projects_total_working_days_check
  check (total_working_days >= 0 and total_working_days = round(total_working_days * 2) / 2);
```

Applied the same way as migrations 0001–0004: this only adds the SQL file:
the user runs it against their Supabase project.

## 2. Rounding/precision convention

Half-day granularity, applied consistently everywhere a day value appears:

- **Direct-entry inputs** (QA capacity, project total working days, PM's
  per-tester days/week on a proposal, QA Lead's rebaseline days/week): HTML
  `step={0.5}`, and the backing Zod schema adds `.multipleOf(0.5, "Must be in
  half-day increments")` alongside the existing `.positive()`/`.min()` check.
- **Computed, read-only display values** (remaining capacity, remaining
  project days, dashboard capacity/allocated/available totals): rounded to
  the nearest 0.5 for display, replacing today's nearest-0.1 rounding
  (`Math.round(value * 10) / 10` → `Math.round(value * 2) / 2`).
- **Computed values that get written automatically** (bulk-assign's even
  split of a project's remaining days across selected QAs; the single-QA
  allocation form's dates-drive-the-load calculation): rounded to the nearest
  0.5 before being saved. A project's total may therefore not divide evenly
  across QAs anymore (5 days ÷ 3 QAs → 1.5/1.5/1.5, summing to 4.5, not 5) —
  expected, not a bug; real day-based effort tracking works this way.

## 3. Backend scope

**Types** (`src/lib/profile.ts`, `project.ts`, `allocation.ts`,
`load.ts`): `capacity_hours`→`capacity_days`, `total_working_hours`→
`total_working_days`, `hours_per_week`/`proposed_hours_per_week`→
`days_per_week`/`proposed_days_per_week`, `AllocationForCalc.hours_per_week`→
`days_per_week`.

**Calc helpers** (`src/lib/load.ts`): `weeklyHoursForUser`→
`weeklyDaysForUser`, `monthlyHoursForUser`→`monthlyDaysForUser`,
`monthlyHoursForProject`→`monthlyDaysForProject`. Formulas are unchanged
(unit-agnostic division/proration) — only names and the doc comments above
them change. `weeklyLoadPercent`'s parameters are renamed
(`allocatedDays`/`capacityDays`) but its body (`(allocated / capacity) *
100`) is untouched. `weeksBetween`/`weekdaysBetween`/`overlapDays` are
already day-based and need no changes.

**Schemas** (`profile-schema.ts`, `project-schema.ts`,
`allocation-schema.ts`): field renames plus the `.multipleOf(0.5, ...)`
addition described in §2.

**Actions** (`profile-action.ts`, `project-action.ts`, `allocation-action.ts`,
`approval-action.ts`, `dashboard-action.ts`): every `.select()`/`.insert()`/
`.update()` column name renamed. `getRemainingProjectHours`→
`getRemainingProjectDays`; `getRemainingUserCapacity` keeps its name (return
value is now days, but "capacity" was never hours-specific in the name).
`WeeklyDashboard.demandByProduct: { hours }`→`{ days }`.

**The two hardcoded ×8 conversions go away.** `project-form-dialog.tsx` and
`project-proposal-card.tsx` currently auto-fill Total Working *Hours* via
`weekdaysBetween(start, end) * 8`. Auto-filling Total Working *Days* is just
`weekdaysBetween(start, end)` — no multiplier.

## 4. Frontend scope

Every UI surface that shows or collects an hours value gets relabeled and,
where it's a direct-entry field, gains `step={0.5}`:

- **Team**: `team-table.tsx` ("Capacity (hrs/wk)" column), `team-form-dialog.tsx`
  (Capacity field + its `"40"` default → `"5"`).
- **Project Portfolio**: `project-table.tsx` ("Total Hrs" column),
  `project-form-dialog.tsx` (Total Working Hours field + auto-fill),
  `propose-project-dialog.tsx` (per-tester "Hrs/Wk" field, default `"8"` →
  `"1"`), `project-assignments-dialog.tsx` ("Hours/Wk" column).
- **Allocation Tool**: `allocation-form.tsx` (Remaining Capacity display,
  "Remaining hours for this item", allocation-preview copy),
  `bulk-assign-dialog.tsx` (remaining-days preview + split copy),
  `rebaseline-dialog.tsx` ("Allocated Hours (Weekly)" field),
  `assignments-table.tsx` ("Hours/Wk" column + footer total),
  `allocations-page-content.tsx` (resource-list "X/Y hrs" display).
- **Approvals**: `approvals-page-content.tsx` (two "Hours/Wk" columns),
  `project-proposal-card.tsx` (Total Working Hours input + auto-fill,
  "Hours/Wk" column).
- **Dashboard**: `dashboard-page-content.tsx` (four stat cards' "hrs/wk"
  units, Capacity-by-QA-Group card's "X/Y hrs" lines),
  `product-demand-pie-chart.tsx` (tooltip's "X hrs" formatter, `data.hours`→
  `data.days`).

**Out of scope, verified during audit**: `month-calendar.tsx` and
`qa-projects-dialog.tsx` only ever display dates/status — no hours anywhere
in either.

## 5. Rollout

Given the size (touches nearly every page in the app), this goes through a
worktree + implementation plan, matching the v3/v4 precedent in this
project: tasks execute inline with `tsc --noEmit` / `eslint` / `npm run
build` checks along the way, followed by a browser smoke-test of Team,
Project Portfolio, Allocation Tool, Approvals, and Dashboard before merging.
