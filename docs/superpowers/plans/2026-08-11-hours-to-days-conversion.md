# Hours-to-Days Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert every capacity/allocation/budget number in the QA Resource Manager app from hours to days — DB columns, Zod schemas, server actions, calculation helpers, and every UI label/input — per `docs/superpowers/specs/2026-08-11-hours-to-days-conversion-design.md`.

**Architecture:** A single DB migration renames and transforms three columns (`profiles.capacity_hours`→`capacity_days`, `allocations.hours_per_week`/`proposed_hours_per_week`→`days_per_week`/`proposed_days_per_week`, `projects.total_working_hours`→`total_working_days`), dividing existing values by 8 and rounding to the nearest 0.5. Every layer above it (types → calc helpers → schemas → server actions → UI) is renamed to match, in that dependency order, so each task's edits compile against the previous task's renamed surface.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase/Postgres, Zod 4, TanStack Query 5, no test framework (verification is `tsc --noEmit` + `eslint` + `npm run build`, matching this project's existing convention).

## Global Constraints

- Conversion rate: 8 hours = 1 day.
- Precision: half-day increments everywhere. Direct-entry inputs get `step={0.5}` plus a Zod `.multipleOf(0.5, ...)` check. Computed *display* values round to the nearest 0.5 (`Math.round(x * 2) / 2`), replacing the current nearest-0.1 (`Math.round(x * 10) / 10`) and nearest-0.01 (`round2`) conventions. Computed values that get **written** automatically (bulk-assign's even split, the single-QA form's dates-drive-the-load calculation) are also rounded to the nearest 0.5 before being saved.
- `weekdaysBetween` is removed; Total Working Days auto-fills via a new `monthsBetween(start, end) * 22` (rounded to nearest 0.5) instead.
- `getRemainingProjectHours` is renamed `getRemainingProjectDays`. `getRemainingUserCapacity` keeps its name (return value is days now, but "capacity" was never hours-specific).
- Every renamed server action / calc helper must be updated at every call site in the same task that renames it, or a documented later task — never left half-renamed across a commit boundary you're not tracking.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/0005_qa_resource_manager_v5.sql`

**Interfaces:**
- Produces: renamed columns `profiles.capacity_days`, `allocations.days_per_week`, `allocations.proposed_days_per_week`, `projects.total_working_days` that every later task's Supabase queries assume exist.

- [ ] **Step 1: Write the migration**

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

- [ ] **Step 2: No automated verification is possible**

This is a SQL file only — there's no local Supabase instance to run it against in this session (matches the precedent set by migrations 0001–0004: written here, applied by the user against their own Supabase project). Review the SQL by eye against Step 1 above; there is nothing to run.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0005_qa_resource_manager_v5.sql
git commit -m "feat: migrate capacity/allocation/budget columns from hours to days"
```

---

### Task 2: Core types and calculation helpers

**Files:**
- Modify: `src/lib/profile.ts`
- Modify: `src/lib/project.ts`
- Modify: `src/lib/allocation.ts`
- Modify: `src/lib/load.ts`

**Interfaces:**
- Consumes: nothing (pure types/helpers, no DB access).
- Produces: `Profile.capacity_days`, `Project.total_working_days`, `Allocation.days_per_week`/`proposed_days_per_week`, `AllocationForCalc.days_per_week`, `weeklyDaysForUser(allocations, userId, week)`, `weeklyLoadPercent(allocatedDays, capacityDays)`, `monthlyDaysForUser(allocations, userId, range)`, `monthlyDaysForProject(allocations, projectId, range)`, `monthsBetween(startDate, endDate)` — every later task's imports from `@/lib/load` and `@/lib/*` types must match these exact names.

- [ ] **Step 1: Rename the type fields**

In `src/lib/profile.ts`, change:

```ts
  capacity_hours: number;
```

to:

```ts
  capacity_days: number;
```

In `src/lib/project.ts`, change:

```ts
  total_working_hours: number;
```

to:

```ts
  total_working_days: number;
```

In `src/lib/allocation.ts`, change:

```ts
  hours_per_week: number;
```

to:

```ts
  days_per_week: number;
```

and change:

```ts
  proposed_hours_per_week: number | null;
```

to:

```ts
  proposed_days_per_week: number | null;
```

- [ ] **Step 2: Rewrite `src/lib/load.ts`**

Replace the entire file with:

```ts
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

/** Months spanned by [startDate, endDate], as a fraction; always at least 1
 *  (mirrors weeksBetween's day/7 pattern, but day/30). */
export function monthsBetween(startDate: string, endDate: string): number {
  const days = Math.round((toUTCDate(endDate).getTime() - toUTCDate(startDate).getTime()) / MS_PER_DAY) + 1;
  return Math.max(1, days / 30);
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
```

- [ ] **Step 3: Verify — expect widespread, expected errors**

Run: `npx tsc --noEmit`

Expected: many errors, ALL in files this task did not touch (every `*-schema.ts`, `*-action.ts`, and `*.tsx` file that references `capacity_hours`, `hours_per_week`, `proposed_hours_per_week`, `total_working_hours`, `weeklyHoursForUser`, `monthlyHoursForUser`, `monthlyHoursForProject`, or `weekdaysBetween`). Confirm there are zero errors reported *inside* `src/lib/profile.ts`, `src/lib/project.ts`, `src/lib/allocation.ts`, or `src/lib/load.ts` themselves — those four files must compile clean on their own.

- [ ] **Step 4: Commit**

```bash
git add src/lib/profile.ts src/lib/project.ts src/lib/allocation.ts src/lib/load.ts
git commit -m "refactor: rename capacity/allocation/budget fields and calc helpers from hours to days"
```

---

### Task 3: Zod schemas

**Files:**
- Modify: `src/features/profile-schema.ts`
- Modify: `src/features/allocation-schema.ts`
- Modify: `src/features/project-schema.ts`

**Interfaces:**
- Consumes: nothing beyond `zod` itself (schemas don't import from `@/lib`).
- Produces: `ProfileInput.capacity_days`, `AllocationInput.days_per_week`, `AllocationChangeInput.days_per_week`, `ProjectInput.total_working_days`, `ProjectProposalProjectInput` (still `ProjectInput.partial({ total_working_days: true })`), `ProposedAllocationInput.days_per_week`, `ApproveProjectProposalInput.total_working_days` — every later action-layer task's `parsed.data.*` field access must match these names.

- [ ] **Step 1: `src/features/profile-schema.ts`**

Change:

```ts
  capacity_hours: z.number().positive("Capacity must be greater than 0"),
```

to:

```ts
  capacity_days: z
    .number()
    .positive("Capacity must be greater than 0")
    .multipleOf(0.5, "Capacity must be in half-day increments"),
```

- [ ] **Step 2: `src/features/allocation-schema.ts`**

Change (in `AllocationInput`):

```ts
  hours_per_week: z.number().positive("Hours must be greater than 0"),
```

to:

```ts
  days_per_week: z
    .number()
    .positive("Days must be greater than 0")
    .multipleOf(0.5, "Days must be in half-day increments"),
```

Change (in `AllocationChangeInput`):

```ts
  hours_per_week: z.number().positive("Hours must be greater than 0"),
```

to:

```ts
  days_per_week: z
    .number()
    .positive("Days must be greater than 0")
    .multipleOf(0.5, "Days must be in half-day increments"),
```

- [ ] **Step 3: `src/features/project-schema.ts`**

Change:

```ts
  total_working_hours: z.number().positive("Total working hours must be greater than 0"),
```

to:

```ts
  total_working_days: z
    .number()
    .positive("Total working days must be greater than 0")
    .multipleOf(0.5, "Total working days must be in half-day increments"),
```

Change:

```ts
// PM proposals never set Total Working Hours — the QA Lead fills it in at
// approval time (see ApproveProjectProposalInput below). Every other field,
// including jira_link/jiva_link, stays required on the proposal path too.
const ProjectProposalProjectInput = ProjectInput.partial({ total_working_hours: true });
```

to:

```ts
// PM proposals never set Total Working Days — the QA Lead fills it in at
// approval time (see ApproveProjectProposalInput below). Every other field,
// including jira_link/jiva_link, stays required on the proposal path too.
const ProjectProposalProjectInput = ProjectInput.partial({ total_working_days: true });
```

Change (in `ProposedAllocationInput`):

```ts
  hours_per_week: z.number().positive("Hours must be greater than 0"),
```

to:

```ts
  days_per_week: z
    .number()
    .positive("Days must be greater than 0")
    .multipleOf(0.5, "Days must be in half-day increments"),
```

Change (`ApproveProjectProposalInput`):

```ts
export const ApproveProjectProposalInput = z.object({
  total_working_hours: z.number().positive("Total working hours must be greater than 0"),
});
```

to:

```ts
export const ApproveProjectProposalInput = z.object({
  total_working_days: z
    .number()
    .positive("Total working days must be greater than 0")
    .multipleOf(0.5, "Total working days must be in half-day increments"),
});
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`

Expected: zero errors inside `src/features/profile-schema.ts`, `allocation-schema.ts`, `project-schema.ts` themselves. Errors persist in every `*-action.ts` and `*.tsx` file not yet touched — that's expected.

- [ ] **Step 5: Commit**

```bash
git add src/features/profile-schema.ts src/features/allocation-schema.ts src/features/project-schema.ts
git commit -m "refactor: rename hours fields to days in Zod schemas, add half-day multipleOf checks"
```

---

### Task 4: Server actions

**Files:**
- Modify: `src/features/profile-action.ts`
- Modify: `src/features/project-action.ts`
- Modify: `src/features/allocation-action.ts`
- Modify: `src/features/approval-action.ts`
- Modify: `src/features/dashboard-action.ts`

**Interfaces:**
- Consumes: `Profile.capacity_days`/`Project.total_working_days`/`Allocation.days_per_week`/`proposed_days_per_week` (Task 2), `weeklyDaysForUser`/`weeklyLoadPercent`/`monthlyDaysForUser`/`monthlyDaysForProject`/`monthsBetween` (Task 2), `ProfileInput.capacity_days`/`AllocationInput.days_per_week`/`AllocationChangeInput.days_per_week`/`ProjectInput.total_working_days`/`ProposedAllocationInput.days_per_week`/`ApproveProjectProposalInput.total_working_days` (Task 3).
- Produces: `getRemainingProjectDays(projectId): Promise<number>` (renamed from `getRemainingProjectHours`), `getRemainingUserCapacity(userId, startDate, endDate): Promise<number>` (name unchanged, now returns days), `WeeklyDashboard.demandByProduct: { productId: string; days: number }[]`, `ResourceLoadRow.allocatedDays: number` — every frontend task's imports and destructuring must match these exact names.

- [ ] **Step 1: `src/features/profile-action.ts`**

Change (in `createProfile`'s insert):

```ts
      qa_group_id: parsed.data.qa_group_id ?? null,
      capacity_hours: parsed.data.capacity_hours,
    })
    .select("*")
    .single();
```

to:

```ts
      qa_group_id: parsed.data.qa_group_id ?? null,
      capacity_days: parsed.data.capacity_days,
    })
    .select("*")
    .single();
```

Change (in `updateProfile`'s update):

```ts
      qa_group_id: parsed.data.qa_group_id ?? null,
      capacity_hours: parsed.data.capacity_hours,
    })
    .eq("id", id);
```

to:

```ts
      qa_group_id: parsed.data.qa_group_id ?? null,
      capacity_days: parsed.data.capacity_days,
    })
    .eq("id", id);
```

- [ ] **Step 2: `src/features/project-action.ts`**

Change (in `createProject`'s insert):

```ts
    total_working_hours: parsed.data.total_working_hours,
```

to:

```ts
    total_working_days: parsed.data.total_working_days,
```

Change (in `releaseAllocationsForCompletedProject`):

```ts
      updates.proposed_hours_per_week = null;
```

to:

```ts
      updates.proposed_days_per_week = null;
```

Change (in `updateProject`'s update):

```ts
      total_working_hours: parsed.data.total_working_hours,
```

to:

```ts
      total_working_days: parsed.data.total_working_days,
```

Change (in `proposeProject`'s project insert):

```ts
      total_working_hours: parsed.data.project.total_working_hours ?? 0,
```

to:

```ts
      total_working_days: parsed.data.project.total_working_days ?? 0,
```

Change (in `proposeProject`'s allocations insert):

```ts
      role_on_project: allocation.role_on_project,
      hours_per_week: allocation.hours_per_week,
      start_date: allocation.start_date,
```

to:

```ts
      role_on_project: allocation.role_on_project,
      days_per_week: allocation.days_per_week,
      start_date: allocation.start_date,
```

- [ ] **Step 3: `src/features/allocation-action.ts`**

Change the import:

```ts
import { monthlyHoursForUser, overlappingProjectCount, weeksBetween } from "@/lib/load";
```

to:

```ts
import { monthlyDaysForUser, overlappingProjectCount, weeksBetween } from "@/lib/load";
```

Change (in `createAllocation`'s insert):

```ts
    role_on_project: parsed.data.role_on_project,
    hours_per_week: parsed.data.hours_per_week,
    start_date: parsed.data.start_date,
```

to:

```ts
    role_on_project: parsed.data.role_on_project,
    days_per_week: parsed.data.days_per_week,
    start_date: parsed.data.start_date,
```

Change (in `updateAllocation`'s update):

```ts
      role_on_project: parsed.data.role_on_project,
      hours_per_week: parsed.data.hours_per_week,
      start_date: parsed.data.start_date,
```

to:

```ts
      role_on_project: parsed.data.role_on_project,
      days_per_week: parsed.data.days_per_week,
      start_date: parsed.data.start_date,
```

Change (in `proposeAllocationChange`'s update):

```ts
      proposed_start_date: parsed.data.start_date,
      proposed_end_date: parsed.data.end_date ?? null,
      proposed_hours_per_week: parsed.data.hours_per_week,
      proposed_priority: parsed.data.priority,
```

to:

```ts
      proposed_start_date: parsed.data.start_date,
      proposed_end_date: parsed.data.end_date ?? null,
      proposed_days_per_week: parsed.data.days_per_week,
      proposed_priority: parsed.data.priority,
```

Change the `createBulkAllocations` doc comment:

```ts
/**
 * Assigns one project/activity to several QAs at once, splitting its
 * `total_working_hours` evenly (per QA, per week, over the item's own
 * date range). Each QA gets an independent allocation row. QA-Lead
 * batches go live immediately (per-QA, subject to the parallel-limit
 * check); PM batches are standalone `pending` proposals, same rule as
 * the single-QA flow. Partial success is expected and reported —
 * one QA failing the limit check doesn't block the others.
 */
```

to:

```ts
/**
 * Assigns one project/activity to several QAs at once, splitting its
 * `total_working_days` evenly (per QA, per week, over the item's own
 * date range, rounded to the nearest half-day). Each QA gets an
 * independent allocation row. QA-Lead batches go live immediately
 * (per-QA, subject to the parallel-limit check); PM batches are
 * standalone `pending` proposals, same rule as the single-QA flow.
 * Partial success is expected and reported — one QA failing the limit
 * check doesn't block the others.
 */
```

Change the `createBulkAllocations` body:

```ts
  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("approval_status, start_date, end_date, total_working_hours")
    .eq("id", parsed.data.project_id)
    .single();

  if (projectError || !project || project.approval_status !== "approved") {
    throw new Error("You can only assign testers to an approved project");
  }
  if (!project.end_date) {
    throw new Error("This item has no end date and can't be evenly split");
  }

  const { data: existingAllocations, error: existingError } = await admin
    .from("allocations")
    .select("hours_per_week, start_date, end_date")
    .eq("project_id", parsed.data.project_id)
    .eq("approval_status", "approved");
  if (existingError) throw new Error(existingError.message);

  const committed = (existingAllocations ?? []).reduce(
    (sum, a) => sum + a.hours_per_week * weeksBetween(a.start_date, a.end_date ?? project.end_date!),
    0,
  );
  const remainingHours = Math.max(0, project.total_working_hours - committed);

  const weeks = weeksBetween(project.start_date, project.end_date);
  const hoursPerWeek = remainingHours / parsed.data.user_ids.length / weeks;
  const isLead = profile.role === "qa_lead";
```

to:

```ts
  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("approval_status, start_date, end_date, total_working_days")
    .eq("id", parsed.data.project_id)
    .single();

  if (projectError || !project || project.approval_status !== "approved") {
    throw new Error("You can only assign testers to an approved project");
  }
  if (!project.end_date) {
    throw new Error("This item has no end date and can't be evenly split");
  }

  const { data: existingAllocations, error: existingError } = await admin
    .from("allocations")
    .select("days_per_week, start_date, end_date")
    .eq("project_id", parsed.data.project_id)
    .eq("approval_status", "approved");
  if (existingError) throw new Error(existingError.message);

  const committed = (existingAllocations ?? []).reduce(
    (sum, a) => sum + a.days_per_week * weeksBetween(a.start_date, a.end_date ?? project.end_date!),
    0,
  );
  const remainingDays = Math.max(0, project.total_working_days - committed);

  const weeks = weeksBetween(project.start_date, project.end_date);
  const daysPerWeek = Math.round((remainingDays / parsed.data.user_ids.length / weeks) * 2) / 2;
  const isLead = profile.role === "qa_lead";
```

Change the insert inside the `for` loop:

```ts
      role_on_project: parsed.data.role_on_project,
      hours_per_week: hoursPerWeek,
      start_date: project.start_date,
```

to:

```ts
      role_on_project: parsed.data.role_on_project,
      days_per_week: daysPerWeek,
      start_date: project.start_date,
```

Change the `getRemainingProjectHours` function entirely:

```ts
/**
 * `total_working_hours` minus what's already committed to this project by
 * its own *approved* allocations (each converted to a total-hours figure via
 * `hours_per_week * weeksBetween(start, end ?? project.end_date)` — every
 * project has a required `end_date` since v2, so an open-ended allocation
 * always has a concrete fallback bound). Floored at 0.
 */
export async function getRemainingProjectHours(projectId: string): Promise<number> {
  const supabase = await createClient();

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("total_working_hours, end_date")
    .eq("id", projectId)
    .single();
  if (projectError || !project) throw new Error(projectError?.message ?? "Item not found");

  const { data: allocations, error } = await supabase
    .from("allocations")
    .select("hours_per_week, start_date, end_date")
    .eq("project_id", projectId)
    .eq("approval_status", "approved");
  if (error) throw new Error(error.message);

  const committed = (allocations ?? []).reduce(
    (sum, a) => sum + a.hours_per_week * weeksBetween(a.start_date, a.end_date ?? project.end_date!),
    0,
  );

  return Math.max(0, project.total_working_hours - committed);
}
```

to:

```ts
/**
 * `total_working_days` minus what's already committed to this project by
 * its own *approved* allocations (each converted to a total-days figure via
 * `days_per_week * weeksBetween(start, end ?? project.end_date)` — every
 * project has a required `end_date` since v2, so an open-ended allocation
 * always has a concrete fallback bound). Floored at 0.
 */
export async function getRemainingProjectDays(projectId: string): Promise<number> {
  const supabase = await createClient();

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("total_working_days, end_date")
    .eq("id", projectId)
    .single();
  if (projectError || !project) throw new Error(projectError?.message ?? "Item not found");

  const { data: allocations, error } = await supabase
    .from("allocations")
    .select("days_per_week, start_date, end_date")
    .eq("project_id", projectId)
    .eq("approval_status", "approved");
  if (error) throw new Error(error.message);

  const committed = (allocations ?? []).reduce(
    (sum, a) => sum + a.days_per_week * weeksBetween(a.start_date, a.end_date ?? project.end_date!),
    0,
  );

  return Math.max(0, project.total_working_days - committed);
}
```

Change the `getRemainingUserCapacity` function:

```ts
/**
 * A QA's weekly capacity minus their *approved* allocations' day-prorated
 * hours within [startDate, endDate], averaged back over the weeks in that
 * range. Scoping to the candidate assignment's own date range (rather than
 * some unrelated fixed week) is what makes this accurate for multi-week
 * items. Floored at 0.
 */
export async function getRemainingUserCapacity(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  const supabase = await createClient();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("capacity_hours")
    .eq("id", userId)
    .single();
  if (profileError || !profile) throw new Error(profileError?.message ?? "Resource not found");

  const { data: allocations, error } = await supabase
    .from("allocations")
    .select("user_id, project_id, hours_per_week, start_date, end_date")
    .eq("user_id", userId)
    .eq("approval_status", "approved");
  if (error) throw new Error(error.message);

  const allocatedInRange = monthlyHoursForUser(allocations ?? [], userId, { start: startDate, end: endDate });
  const weeks = weeksBetween(startDate, endDate);

  return Math.max(0, profile.capacity_hours - allocatedInRange / weeks);
}
```

to:

```ts
/**
 * A QA's weekly capacity minus their *approved* allocations' day-prorated
 * load within [startDate, endDate], averaged back over the weeks in that
 * range. Scoping to the candidate assignment's own date range (rather than
 * some unrelated fixed week) is what makes this accurate for multi-week
 * items. Floored at 0.
 */
export async function getRemainingUserCapacity(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  const supabase = await createClient();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("capacity_days")
    .eq("id", userId)
    .single();
  if (profileError || !profile) throw new Error(profileError?.message ?? "Resource not found");

  const { data: allocations, error } = await supabase
    .from("allocations")
    .select("user_id, project_id, days_per_week, start_date, end_date")
    .eq("user_id", userId)
    .eq("approval_status", "approved");
  if (error) throw new Error(error.message);

  const allocatedInRange = monthlyDaysForUser(allocations ?? [], userId, { start: startDate, end: endDate });
  const weeks = weeksBetween(startDate, endDate);

  return Math.max(0, profile.capacity_days - allocatedInRange / weeks);
}
```

- [ ] **Step 4: `src/features/approval-action.ts`**

Change (in `approveProjectProposal`):

```ts
    .update({ approval_status: "approved", total_working_hours: parsed.data.total_working_hours })
```

to:

```ts
    .update({ approval_status: "approved", total_working_days: parsed.data.total_working_days })
```

Change (in `approveAllocationChange`'s select):

```ts
    .select("user_id, project_id, proposed_start_date, proposed_end_date, proposed_hours_per_week, proposed_priority")
```

to:

```ts
    .select("user_id, project_id, proposed_start_date, proposed_end_date, proposed_days_per_week, proposed_priority")
```

Change (in `approveAllocationChange`'s update):

```ts
      start_date: allocation.proposed_start_date,
      end_date: allocation.proposed_end_date,
      hours_per_week: allocation.proposed_hours_per_week,
      priority: allocation.proposed_priority,
      proposed_start_date: null,
      proposed_end_date: null,
      proposed_hours_per_week: null,
      proposed_priority: null,
```

to:

```ts
      start_date: allocation.proposed_start_date,
      end_date: allocation.proposed_end_date,
      days_per_week: allocation.proposed_days_per_week,
      priority: allocation.proposed_priority,
      proposed_start_date: null,
      proposed_end_date: null,
      proposed_days_per_week: null,
      proposed_priority: null,
```

Change (in `rejectAllocationChange`'s update):

```ts
      proposed_start_date: null,
      proposed_end_date: null,
      proposed_hours_per_week: null,
      proposed_priority: null,
```

to:

```ts
      proposed_start_date: null,
      proposed_end_date: null,
      proposed_days_per_week: null,
      proposed_priority: null,
```

- [ ] **Step 5: Rewrite `src/features/dashboard-action.ts`**

Replace the entire file with:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import {
  isoWeekRange,
  monthRange,
  weeklyDaysForUser,
  weeklyLoadPercent,
  monthlyDaysForUser as rangeDaysForUser,
  monthlyDaysForProject as rangeDaysForProject,
  weeksBetween,
  type AllocationForCalc,
  type DateRange,
} from "@/lib/load";
import type { Profile } from "@/lib/profile";
import type { Project } from "@/lib/project";

const RESOURCE_ROLES = ["qa_lead", "qa_member"] as const;

async function getActiveResources(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_active", true)
    .in("role", RESOURCE_ROLES);
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

async function getApprovedAllocationsInRange(start: string, end: string): Promise<AllocationForCalc[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("allocations")
    .select("user_id, project_id, days_per_week, start_date, end_date")
    .eq("approval_status", "approved")
    .lte("start_date", end)
    .or(`end_date.is.null,end_date.gte.${start}`);
  if (error) throw new Error(error.message);
  return (data ?? []) as AllocationForCalc[];
}

async function getProjectsByIds(ids: string[]): Promise<Project[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").select("*").in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as Project[];
}

export type ResourceLoadRow = {
  profile: Profile;
  allocatedDays: number;
  loadPercent: number;
};

export type WeeklyDashboard = {
  totalCapacity: number;
  totalAllocated: number;
  availableCapacity: number;
  resourceLoad: ResourceLoadRow[];
  demandByProduct: { productId: string; days: number }[];
};

export async function getWeeklyDashboard(weekStartISO: string): Promise<WeeklyDashboard> {
  const week = isoWeekRange(new Date(`${weekStartISO}T00:00:00Z`));
  const [resources, allocations] = await Promise.all([
    getActiveResources(),
    getApprovedAllocationsInRange(week.start, week.end),
  ]);

  const resourceLoad: ResourceLoadRow[] = resources.map((profile) => {
    const allocatedDays = weeklyDaysForUser(allocations, profile.id, week);
    return {
      profile,
      allocatedDays,
      loadPercent: weeklyLoadPercent(allocatedDays, profile.capacity_days),
    };
  });

  const totalCapacity = resources.reduce((sum, p) => sum + p.capacity_days, 0);
  const totalAllocated = resourceLoad.reduce((sum, r) => sum + r.allocatedDays, 0);

  const daysByProject = new Map<string, number>();
  for (const allocation of allocations) {
    daysByProject.set(allocation.project_id, (daysByProject.get(allocation.project_id) ?? 0) + allocation.days_per_week);
  }

  const projectIds = [...daysByProject.keys()];
  const projects = await getProjectsByIds(projectIds);

  const daysByProductId = new Map<string, number>();
  for (const project of projects) {
    const days = daysByProject.get(project.id) ?? 0;
    daysByProductId.set(project.product_id, (daysByProductId.get(project.product_id) ?? 0) + days);
  }
  const demandByProduct = [...daysByProductId.entries()]
    .map(([productId, days]) => ({ productId, days }))
    .sort((a, b) => b.days - a.days);

  return {
    totalCapacity,
    totalAllocated,
    availableCapacity: totalCapacity - totalAllocated,
    resourceLoad,
    demandByProduct,
  };
}

/**
 * Same shape as `getWeeklyDashboard`, but for an arbitrary [start, end] range
 * instead of one fixed ISO week — `allocatedDays` per QA (and `days` per
 * product in `demandByProduct`) is the range's total prorated days divided
 * by how many weeks the range spans, i.e. an average days/week figure, so the
 * existing 80%/100% load thresholds and days/wk-labeled UI keep meaning
 * unchanged no matter how wide a range is picked.
 */
export async function getRangeDashboard(startDateISO: string, endDateISO: string): Promise<WeeklyDashboard> {
  if (startDateISO > endDateISO) {
    throw new Error("End date must be on or after start date");
  }

  const range: DateRange = { start: startDateISO, end: endDateISO };
  const weeks = weeksBetween(startDateISO, endDateISO);
  const [resources, allocations] = await Promise.all([
    getActiveResources(),
    getApprovedAllocationsInRange(range.start, range.end),
  ]);

  const resourceLoad: ResourceLoadRow[] = resources.map((profile) => {
    const allocatedDays = rangeDaysForUser(allocations, profile.id, range) / weeks;
    return {
      profile,
      allocatedDays,
      loadPercent: weeklyLoadPercent(allocatedDays, profile.capacity_days),
    };
  });

  const totalCapacity = resources.reduce((sum, p) => sum + p.capacity_days, 0);
  const totalAllocated = resourceLoad.reduce((sum, r) => sum + r.allocatedDays, 0);

  const projectIds = [...new Set(allocations.map((a) => a.project_id))];
  const projects = await getProjectsByIds(projectIds);

  const daysByProductId = new Map<string, number>();
  for (const project of projects) {
    const days = rangeDaysForProject(allocations, project.id, range) / weeks;
    daysByProductId.set(project.product_id, (daysByProductId.get(project.product_id) ?? 0) + days);
  }
  const demandByProduct = [...daysByProductId.entries()]
    .map(([productId, days]) => ({ productId, days }))
    .sort((a, b) => b.days - a.days);

  return {
    totalCapacity,
    totalAllocated,
    availableCapacity: totalCapacity - totalAllocated,
    resourceLoad,
    demandByProduct,
  };
}

/**
 * A QA's approved, non-completed items overlapping the given week — the
 * detail behind their "Capacity by QA Group" row on the Dashboard.
 */
export async function getInProgressProjectsForUser(userId: string, weekStartISO: string): Promise<Project[]> {
  const week = isoWeekRange(new Date(`${weekStartISO}T00:00:00Z`));
  const supabase = await createClient();

  const { data: allocations, error } = await supabase
    .from("allocations")
    .select("project_id")
    .eq("user_id", userId)
    .eq("approval_status", "approved")
    .lte("start_date", week.end)
    .or(`end_date.is.null,end_date.gte.${week.start}`);
  if (error) throw new Error(error.message);

  const projectIds = [...new Set((allocations ?? []).map((a) => a.project_id))];
  if (projectIds.length === 0) return [];

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("*")
    .in("id", projectIds)
    .neq("status", "completed");
  if (projectsError) throw new Error(projectsError.message);
  return (projects ?? []) as Project[];
}

/** Approved work items overlapping the given month, for the Dashboard's calendar view. */
export async function getProjectsForMonth(year: number, monthIndex0: number): Promise<Project[]> {
  const month = monthRange(year, monthIndex0);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("approval_status", "approved")
    .lte("start_date", month.end)
    .or(`end_date.is.null,end_date.gte.${month.start}`);
  if (error) throw new Error(error.message);
  return (data ?? []) as Project[];
}
```

- [ ] **Step 6: Verify — expect errors isolated to UI files**

Run: `npx tsc --noEmit`

Expected: zero errors inside any file under `src/features/*.ts`. Every remaining error should be in a `.tsx` file under `src/components/` or `src/app/` (or `scripts/seed-qa-lead.ts`) — those are Tasks 5–9.

- [ ] **Step 7: Commit**

```bash
git add src/features/profile-action.ts src/features/project-action.ts src/features/allocation-action.ts src/features/approval-action.ts src/features/dashboard-action.ts
git commit -m "refactor: rename hours fields to days across server actions, add getRemainingProjectDays"
```

---

### Task 5: Team page

**Files:**
- Modify: `src/components/team/team-table.tsx`
- Modify: `src/components/team/team-form-dialog.tsx`
- Modify: `scripts/seed-qa-lead.ts`

**Interfaces:**
- Consumes: `Profile.capacity_days` (Task 2), `ProfileInput.capacity_days` (Task 3), `createProfile`/`updateProfile` (Task 4, unchanged names, renamed payload field).
- Produces: nothing consumed by later tasks (Team page is a leaf).

- [ ] **Step 1: `src/components/team/team-table.tsx`**

Change:

```tsx
              <TableHead className="text-right">Capacity (hrs/wk)</TableHead>
```

to:

```tsx
              <TableHead className="text-right">Capacity (days/wk)</TableHead>
```

Change:

```tsx
                  <TableCell className="text-right text-sm tabular-nums">{profile.capacity_hours}</TableCell>
```

to:

```tsx
                  <TableCell className="text-right text-sm tabular-nums">{profile.capacity_days}</TableCell>
```

- [ ] **Step 2: `src/components/team/team-form-dialog.tsx`**

Change the `FormState` type:

```ts
  qa_group_id: string; // "none" sentinel, or a qa_groups.id
  capacity_hours: string;
};
```

to:

```ts
  qa_group_id: string; // "none" sentinel, or a qa_groups.id
  capacity_days: string;
};
```

Change `formFromProfile`:

```ts
        qa_group_id: profile.qa_group_id ?? "none",
        capacity_hours: String(profile.capacity_hours),
      }
    : { name: "", email: "", role: "qa_member", qa_group_id: "none", capacity_hours: "40" };
```

to:

```ts
        qa_group_id: profile.qa_group_id ?? "none",
        capacity_days: String(profile.capacity_days),
      }
    : { name: "", email: "", role: "qa_member", qa_group_id: "none", capacity_days: "5" };
```

Change the submit payload:

```ts
        qa_group_id: form.qa_group_id === "none" ? undefined : form.qa_group_id,
        capacity_hours: Number(form.capacity_hours),
      };
```

to:

```ts
        qa_group_id: form.qa_group_id === "none" ? undefined : form.qa_group_id,
        capacity_days: Number(form.capacity_days),
      };
```

Change the input field:

```tsx
              <Label htmlFor="capacity">Capacity (hrs/wk)</Label>
              <Input
                id="capacity"
                type="number"
                min={1}
                step={1}
                value={form.capacity_hours}
                onChange={(e) => setForm((f) => ({ ...f, capacity_hours: e.target.value }))}
                required
              />
```

to:

```tsx
              <Label htmlFor="capacity">Capacity (days/wk)</Label>
              <Input
                id="capacity"
                type="number"
                min={0.5}
                step={0.5}
                value={form.capacity_days}
                onChange={(e) => setForm((f) => ({ ...f, capacity_days: e.target.value }))}
                required
              />
```

- [ ] **Step 3: `scripts/seed-qa-lead.ts`**

Change:

```ts
    role: "qa_lead",
    capacity_hours: 40,
  });
```

to:

```ts
    role: "qa_lead",
    capacity_days: 5,
  });
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`

Expected: zero errors in `src/components/team/*.tsx` and `scripts/seed-qa-lead.ts`. Errors remain in Project Portfolio, Allocation Tool, Approvals, and Dashboard files — expected until Tasks 6–9.

Run: `npx eslint src/components/team/team-table.tsx src/components/team/team-form-dialog.tsx scripts/seed-qa-lead.ts`

Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add src/components/team/team-table.tsx src/components/team/team-form-dialog.tsx scripts/seed-qa-lead.ts
git commit -m "refactor: rename capacity_hours to capacity_days on the Team page"
```

---

### Task 6: Project Portfolio

**Files:**
- Modify: `src/components/projects/project-table.tsx`
- Modify: `src/components/projects/project-form-dialog.tsx`
- Modify: `src/components/projects/propose-project-dialog.tsx`
- Modify: `src/components/projects/project-assignments-dialog.tsx`

**Interfaces:**
- Consumes: `Project.total_working_days`, `Allocation.days_per_week` (Task 2), `ProjectInput.total_working_days`, `ProposedAllocationInput.days_per_week` (Task 3), `createProject`/`updateProject`/`proposeProject` (Task 4), `monthsBetween` (Task 2).
- Produces: nothing consumed by later tasks (Project Portfolio is a leaf).

- [ ] **Step 1: `src/components/projects/project-table.tsx`**

Change:

```tsx
              <TableHead className="text-right">Total Hrs</TableHead>
```

to:

```tsx
              <TableHead className="text-right">Total Days</TableHead>
```

Change:

```tsx
                  <TableCell className="text-right text-sm tabular-nums">{project.total_working_hours}</TableCell>
```

to:

```tsx
                  <TableCell className="text-right text-sm tabular-nums">{project.total_working_days}</TableCell>
```

- [ ] **Step 2: `src/components/projects/project-form-dialog.tsx`**

Change the import:

```ts
import { weekdaysBetween } from "@/lib/load";
```

to:

```ts
import { monthsBetween } from "@/lib/load";
```

Change the `FormState` type:

```ts
  progress_percent: string;
  total_working_hours: string;
  priority: Priority;
```

to:

```ts
  progress_percent: string;
  total_working_days: string;
  priority: Priority;
```

Change `formFromProject`:

```ts
        progress_percent: String(project.progress_percent),
        total_working_hours: String(project.total_working_hours),
        priority: project.priority,
```

to:

```ts
        progress_percent: String(project.progress_percent),
        total_working_days: String(project.total_working_days),
        priority: project.priority,
```

and:

```ts
        progress_percent: "0",
        total_working_hours: "",
        priority: "medium",
```

to:

```ts
        progress_percent: "0",
        total_working_days: "",
        priority: "medium",
```

Change the auto-fill comment and function:

```ts
  // Total Working Hours auto-fills from the dates on create; once the QA
  // Lead edits it directly, later date changes stop overwriting it.
  const [hoursTouched, setHoursTouched] = useState(false);
  const queryClient = useQueryClient();

  function applyDateChange(startDate: string, endDate: string) {
    if (isEdit || hoursTouched || startDate === "" || endDate === "" || endDate < startDate) return;
    setForm((f) => ({ ...f, total_working_hours: String(weekdaysBetween(startDate, endDate) * 8) }));
  }
```

to:

```ts
  // Total Working Days auto-fills from the dates on create (months spanned
  // x 22 working days/month, rounded to the nearest half-day); once the QA
  // Lead edits it directly, later date changes stop overwriting it.
  const [daysTouched, setDaysTouched] = useState(false);
  const queryClient = useQueryClient();

  function applyDateChange(startDate: string, endDate: string) {
    if (isEdit || daysTouched || startDate === "" || endDate === "" || endDate < startDate) return;
    const days = Math.round(monthsBetween(startDate, endDate) * 22 * 2) / 2;
    setForm((f) => ({ ...f, total_working_days: String(days) }));
  }
```

Change the submit payload:

```ts
        progress_percent: Number(form.progress_percent),
        total_working_hours: Number(form.total_working_hours),
        priority: form.priority,
```

to:

```ts
        progress_percent: Number(form.progress_percent),
        total_working_days: Number(form.total_working_days),
        priority: form.priority,
```

Change the input field:

```tsx
              <Label htmlFor="total_working_hours">Total Working Hours</Label>
              <Input
                id="total_working_hours"
                type="number"
                min={1}
                step={1}
                value={form.total_working_hours}
                onChange={(e) => {
                  setHoursTouched(true);
                  setForm((f) => ({ ...f, total_working_hours: e.target.value }));
                }}
                required
              />
```

to:

```tsx
              <Label htmlFor="total_working_days">Total Working Days</Label>
              <Input
                id="total_working_days"
                type="number"
                min={0.5}
                step={0.5}
                value={form.total_working_days}
                onChange={(e) => {
                  setDaysTouched(true);
                  setForm((f) => ({ ...f, total_working_days: e.target.value }));
                }}
                required
              />
```

- [ ] **Step 3: `src/components/projects/propose-project-dialog.tsx`**

Change the `AllocationRow` type:

```ts
type AllocationRow = {
  user_id: string;
  role_on_project: string;
  hours_per_week: string;
  start_date: string;
  end_date: string;
};

function emptyAllocationRow(): AllocationRow {
  return { user_id: "", role_on_project: "", hours_per_week: "8", start_date: "", end_date: "" };
}
```

to:

```ts
type AllocationRow = {
  user_id: string;
  role_on_project: string;
  days_per_week: string;
  start_date: string;
  end_date: string;
};

function emptyAllocationRow(): AllocationRow {
  return { user_id: "", role_on_project: "", days_per_week: "1", start_date: "", end_date: "" };
}
```

Change the submit payload's allocations mapping:

```ts
        allocations: rows.map((row) => ({
          user_id: row.user_id,
          role_on_project: row.role_on_project,
          hours_per_week: Number(row.hours_per_week),
          start_date: row.start_date,
          end_date: row.end_date || undefined,
        })),
```

to:

```ts
        allocations: rows.map((row) => ({
          user_id: row.user_id,
          role_on_project: row.role_on_project,
          days_per_week: Number(row.days_per_week),
          start_date: row.start_date,
          end_date: row.end_date || undefined,
        })),
```

Change the per-row field:

```tsx
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Hrs/Wk</Label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={row.hours_per_week}
                    onChange={(e) => updateRow(index, { hours_per_week: e.target.value })}
                    required
                  />
                </div>
```

to:

```tsx
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Days/Wk</Label>
                  <Input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={row.days_per_week}
                    onChange={(e) => updateRow(index, { days_per_week: e.target.value })}
                    required
                  />
                </div>
```

- [ ] **Step 4: `src/components/projects/project-assignments-dialog.tsx`**

Change:

```tsx
              <TableHead className="text-right">Hours/Wk</TableHead>
```

to:

```tsx
              <TableHead className="text-right">Days/Wk</TableHead>
```

Change:

```tsx
                  <TableCell className="text-right text-sm tabular-nums">
                    {Math.round(allocation.hours_per_week * 10) / 10}
                  </TableCell>
```

to:

```tsx
                  <TableCell className="text-right text-sm tabular-nums">
                    {Math.round(allocation.days_per_week * 2) / 2}
                  </TableCell>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`

Expected: zero errors under `src/components/projects/`. Errors remain in Allocation Tool, Approvals, and Dashboard files.

Run: `npx eslint src/components/projects/project-table.tsx src/components/projects/project-form-dialog.tsx src/components/projects/propose-project-dialog.tsx src/components/projects/project-assignments-dialog.tsx`

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/projects/project-table.tsx src/components/projects/project-form-dialog.tsx src/components/projects/propose-project-dialog.tsx src/components/projects/project-assignments-dialog.tsx
git commit -m "refactor: rename hours fields to days on the Project Portfolio page"
```

---

### Task 7: Approvals

**Files:**
- Modify: `src/components/approvals/project-proposal-card.tsx`
- Modify: `src/components/approvals/approvals-page-content.tsx`

**Interfaces:**
- Consumes: `Allocation.days_per_week`/`proposed_days_per_week` (Task 2), `monthsBetween` (Task 2), `approveProjectProposal` (Task 4, unchanged name, renamed payload field).
- Produces: nothing consumed by later tasks (Approvals is a leaf).

- [ ] **Step 1: `src/components/approvals/project-proposal-card.tsx`**

Change the import:

```ts
import { weekdaysBetween } from "@/lib/load";
```

to:

```ts
import { monthsBetween } from "@/lib/load";
```

Change the component:

```ts
type ProjectProposalCardProps = {
  proposal: PendingProjectProposal;
  productName: string;
  onApprove: (totalWorkingHours: number) => void;
  onReject: () => void;
  approving: boolean;
  rejecting: boolean;
};

export function ProjectProposalCard({
  proposal,
  productName,
  onApprove,
  onReject,
  approving,
  rejecting,
}: ProjectProposalCardProps) {
  const [hours, setHours] = useState(() =>
    proposal.end_date ? String(weekdaysBetween(proposal.start_date, proposal.end_date) * 8) : "",
  );
  const parsedHours = Number(hours);
  const canApprove = hours.trim() !== "" && parsedHours > 0;
```

to:

```ts
type ProjectProposalCardProps = {
  proposal: PendingProjectProposal;
  productName: string;
  onApprove: (totalWorkingDays: number) => void;
  onReject: () => void;
  approving: boolean;
  rejecting: boolean;
};

export function ProjectProposalCard({
  proposal,
  productName,
  onApprove,
  onReject,
  approving,
  rejecting,
}: ProjectProposalCardProps) {
  const [days, setDays] = useState(() =>
    proposal.end_date
      ? String(Math.round(monthsBetween(proposal.start_date, proposal.end_date) * 22 * 2) / 2)
      : "",
  );
  const parsedDays = Number(days);
  const canApprove = days.trim() !== "" && parsedDays > 0;
```

Change the input field and buttons:

```tsx
          <div className="space-y-1">
            <Label htmlFor={`hours-${proposal.id}`} className="text-xs text-muted-foreground">
              Total Working Hours
            </Label>
            <Input
              id={`hours-${proposal.id}`}
              type="number"
              min={1}
              step={1}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="w-28"
            />
          </div>
          <Button size="sm" variant="outline" disabled={rejecting} onClick={onReject}>
            <X className="size-4" />
            Reject
          </Button>
          <Button size="sm" disabled={!canApprove || approving} onClick={() => onApprove(parsedHours)}>
            <Check className="size-4" />
            Approve
          </Button>
```

to:

```tsx
          <div className="space-y-1">
            <Label htmlFor={`days-${proposal.id}`} className="text-xs text-muted-foreground">
              Total Working Days
            </Label>
            <Input
              id={`days-${proposal.id}`}
              type="number"
              min={0.5}
              step={0.5}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-28"
            />
          </div>
          <Button size="sm" variant="outline" disabled={rejecting} onClick={onReject}>
            <X className="size-4" />
            Reject
          </Button>
          <Button size="sm" disabled={!canApprove || approving} onClick={() => onApprove(parsedDays)}>
            <Check className="size-4" />
            Approve
          </Button>
```

Change the allocations table:

```tsx
            <TableHead className="text-right">Hours/Wk</TableHead>
```

to:

```tsx
            <TableHead className="text-right">Days/Wk</TableHead>
```

```tsx
              <TableCell className="text-right tabular-nums">{allocation.hours_per_week}</TableCell>
```

to:

```tsx
              <TableCell className="text-right tabular-nums">{allocation.days_per_week}</TableCell>
```

- [ ] **Step 2: `src/components/approvals/approvals-page-content.tsx`**

Change the mutation:

```ts
  const approveProjectMutation = useMutation({
    mutationFn: ({ id, totalWorkingHours }: { id: string; totalWorkingHours: number }) =>
      approveProjectProposal(id, { total_working_hours: totalWorkingHours }),
```

to:

```ts
  const approveProjectMutation = useMutation({
    mutationFn: ({ id, totalWorkingDays }: { id: string; totalWorkingDays: number }) =>
      approveProjectProposal(id, { total_working_days: totalWorkingDays }),
```

Change the card wiring:

```tsx
                onApprove={(totalWorkingHours) =>
                  approveProjectMutation.mutate({ id: proposal.id, totalWorkingHours })
                }
```

to:

```tsx
                onApprove={(totalWorkingDays) =>
                  approveProjectMutation.mutate({ id: proposal.id, totalWorkingDays })
                }
```

Change the two "Hours/Wk" table headers:

```tsx
                <TableHead className="text-right">Hours/Wk</TableHead>
```

(appears twice — once in "Future Assignment Proposals", once in "Pending Allocation Changes") to:

```tsx
                <TableHead className="text-right">Days/Wk</TableHead>
```

Change the "Future Assignment Proposals" row cell:

```tsx
                    <TableCell className="text-right tabular-nums">{allocation.hours_per_week}</TableCell>
```

to:

```tsx
                    <TableCell className="text-right tabular-nums">{allocation.days_per_week}</TableCell>
```

Change the "Pending Allocation Changes" table's "Current"/"Proposed" rows:

```tsx
                      <TableCell className="text-right tabular-nums">{allocation.hours_per_week}</TableCell>
```

to:

```tsx
                      <TableCell className="text-right tabular-nums">{allocation.days_per_week}</TableCell>
```

and:

```tsx
                      <TableCell className="text-right font-medium tabular-nums">
                        {allocation.proposed_hours_per_week}
                      </TableCell>
```

to:

```tsx
                      <TableCell className="text-right font-medium tabular-nums">
                        {allocation.proposed_days_per_week}
                      </TableCell>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`

Expected: zero errors under `src/components/approvals/`. Errors remain in Allocation Tool and Dashboard files.

Run: `npx eslint src/components/approvals/project-proposal-card.tsx src/components/approvals/approvals-page-content.tsx`

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/components/approvals/project-proposal-card.tsx src/components/approvals/approvals-page-content.tsx
git commit -m "refactor: rename hours fields to days on the Approvals page"
```

---

### Task 8: Allocation Tool

**Files:**
- Modify: `src/components/allocations/allocation-form.tsx`
- Modify: `src/components/allocations/bulk-assign-dialog.tsx`
- Modify: `src/components/allocations/rebaseline-dialog.tsx`
- Modify: `src/components/allocations/assignments-table.tsx`
- Modify: `src/components/allocations/allocations-page-content.tsx`

**Interfaces:**
- Consumes: `Allocation.days_per_week`/`proposed_days_per_week`, `Profile.capacity_days` (Task 2), `AllocationInput.days_per_week`/`AllocationChangeInput.days_per_week` (Task 3), `getRemainingProjectDays`, `getRemainingUserCapacity`, `createAllocation`/`updateAllocation`/`proposeAllocationChange`/`createBulkAllocations` (Task 4), `ResourceLoadRow.allocatedDays` (Task 4).
- Produces: nothing consumed by later tasks (Allocation Tool is a leaf).

- [ ] **Step 1: `src/components/allocations/allocation-form.tsx`**

Change the import:

```ts
import { createAllocation, getRemainingProjectHours, getRemainingUserCapacity } from "@/features/allocation-action";
```

to:

```ts
import { createAllocation, getRemainingProjectDays, getRemainingUserCapacity } from "@/features/allocation-action";
```

Change the props type and function signature:

```ts
type AllocationFormProps = {
  userId: string;
  userName: string;
  capacityHours: number;
  allocatedHours: number;
  projects: Project[];
  role: ProfileRole;
};

export function AllocationForm({ userId, userName, capacityHours, allocatedHours, projects, role }: AllocationFormProps) {
```

to:

```ts
type AllocationFormProps = {
  userId: string;
  userName: string;
  capacityDays: number;
  allocatedDays: number;
  projects: Project[];
  role: ProfileRole;
};

export function AllocationForm({ userId, userName, capacityDays, allocatedDays, projects, role }: AllocationFormProps) {
```

Change the remaining-project-days query:

```ts
  const { data: remainingHours } = useQuery({
    queryKey: ["remaining-project-hours", projectId],
    queryFn: () => getRemainingProjectHours(projectId),
    enabled: projectId !== "",
  });
```

to:

```ts
  const { data: remainingDays } = useQuery({
    queryKey: ["remaining-project-days", projectId],
    queryFn: () => getRemainingProjectDays(projectId),
    enabled: projectId !== "",
  });
```

Change the derived calculations:

```ts
  // Once dates are picked, base remaining capacity on the QA's load over
  // those specific dates rather than the page's own planning-period range —
  // this stays correct even when the item spans multiple weeks.
  const remainingCapacity =
    validDates && rangeRemainingCapacity !== undefined
      ? rangeRemainingCapacity
      : Math.max(0, capacityHours - allocatedHours);
  const weeks = validDates ? weeksBetween(startDate, endDate) : null;
  const computedHoursPerWeek = remainingHours !== undefined && weeks !== null ? remainingHours / weeks : null;
  const overCapacity = computedHoursPerWeek !== null && computedHoursPerWeek > remainingCapacity;
  const canSubmit =
    projectId !== "" && roleOnProject.trim() !== "" && computedHoursPerWeek !== null && computedHoursPerWeek > 0 && !overCapacity;
```

to:

```ts
  // Once dates are picked, base remaining capacity on the QA's load over
  // those specific dates rather than the page's own planning-period range —
  // this stays correct even when the item spans multiple weeks.
  const remainingCapacity =
    validDates && rangeRemainingCapacity !== undefined
      ? rangeRemainingCapacity
      : Math.max(0, capacityDays - allocatedDays);
  const weeks = validDates ? weeksBetween(startDate, endDate) : null;
  const computedDaysPerWeek =
    remainingDays !== undefined && weeks !== null ? Math.round((remainingDays / weeks) * 2) / 2 : null;
  const overCapacity = computedDaysPerWeek !== null && computedDaysPerWeek > remainingCapacity;
  const canSubmit =
    projectId !== "" && roleOnProject.trim() !== "" && computedDaysPerWeek !== null && computedDaysPerWeek > 0 && !overCapacity;
```

Change the mutation:

```ts
      createAllocation({
        user_id: userId,
        project_id: projectId,
        role_on_project: roleOnProject,
        hours_per_week: computedHoursPerWeek!,
        start_date: startDate,
        end_date: endDate || undefined,
        priority,
      }),
    onSuccess: () => {
      toast.success(role === "qa_lead" ? "Resource assigned" : "Assignment proposed — pending QA Lead approval");
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["range-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", userId] });
      queryClient.invalidateQueries({ queryKey: ["remaining-project-hours", projectId] });
      queryClient.invalidateQueries({ queryKey: ["remaining-user-capacity", userId] });
```

to:

```ts
      createAllocation({
        user_id: userId,
        project_id: projectId,
        role_on_project: roleOnProject,
        days_per_week: computedDaysPerWeek!,
        start_date: startDate,
        end_date: endDate || undefined,
        priority,
      }),
    onSuccess: () => {
      toast.success(role === "qa_lead" ? "Resource assigned" : "Assignment proposed — pending QA Lead approval");
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["range-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", userId] });
      queryClient.invalidateQueries({ queryKey: ["remaining-project-days", projectId] });
      queryClient.invalidateQueries({ queryKey: ["remaining-user-capacity", userId] });
```

Change the display copy:

```tsx
        <div className="flex justify-between">
          <span className="text-muted-foreground">Remaining Capacity</span>
          <span className="font-medium">{Math.round(remainingCapacity * 10) / 10} hrs / week</span>
        </div>
```

to:

```tsx
        <div className="flex justify-between">
          <span className="text-muted-foreground">Remaining Capacity</span>
          <span className="font-medium">{Math.round(remainingCapacity * 2) / 2} days / week</span>
        </div>
```

Change:

```tsx
        {selectedProject && (
          <p className="text-xs text-muted-foreground">
            Remaining hours for this item:{" "}
            {remainingHours !== undefined ? `${Math.round(remainingHours * 10) / 10} hrs` : "..."}
          </p>
        )}
```

to:

```tsx
        {selectedProject && (
          <p className="text-xs text-muted-foreground">
            Remaining days for this item:{" "}
            {remainingDays !== undefined ? `${Math.round(remainingDays * 2) / 2} days` : "..."}
          </p>
        )}
```

Change the over-capacity messaging:

```tsx
      {computedHoursPerWeek !== null && (
        <p className={`text-sm ${overCapacity ? "text-rose-600" : "text-muted-foreground"}`}>
          This will allocate ~{Math.round(computedHoursPerWeek * 10) / 10} hrs/week.
          {overCapacity &&
            ` This QA only has ${Math.round(remainingCapacity * 10) / 10} hrs/week available — widen the date range or pick a different QA.`}
        </p>
      )}
```

to:

```tsx
      {computedDaysPerWeek !== null && (
        <p className={`text-sm ${overCapacity ? "text-rose-600" : "text-muted-foreground"}`}>
          This will allocate ~{Math.round(computedDaysPerWeek * 2) / 2} days/week.
          {overCapacity &&
            ` This QA only has ${Math.round(remainingCapacity * 2) / 2} days/week available — widen the date range or pick a different QA.`}
        </p>
      )}
```

- [ ] **Step 2: `src/components/allocations/bulk-assign-dialog.tsx`**

Change the import:

```ts
import { createBulkAllocations, getRemainingProjectHours } from "@/features/allocation-action";
```

to:

```ts
import { createBulkAllocations, getRemainingProjectDays } from "@/features/allocation-action";
```

Change the query and preview calc:

```ts
  const { data: remainingHours } = useQuery({
    queryKey: ["remaining-project-hours", projectId],
    queryFn: () => getRemainingProjectHours(projectId),
    enabled: projectId !== "",
  });

  const previewHoursPerWeek =
    selectedProject && selectedProject.end_date && remainingHours !== undefined && selectedUserIds.length > 0
      ? remainingHours / selectedUserIds.length / weeksBetween(selectedProject.start_date, selectedProject.end_date)
      : null;
```

to:

```ts
  const { data: remainingDays } = useQuery({
    queryKey: ["remaining-project-days", projectId],
    queryFn: () => getRemainingProjectDays(projectId),
    enabled: projectId !== "",
  });

  const previewDaysPerWeek =
    selectedProject && selectedProject.end_date && remainingDays !== undefined && selectedUserIds.length > 0
      ? Math.round(
          (remainingDays / selectedUserIds.length / weeksBetween(selectedProject.start_date, selectedProject.end_date)) * 2,
        ) / 2
      : null;
```

Change the invalidation:

```ts
      queryClient.invalidateQueries({ queryKey: ["remaining-project-hours", projectId] });
```

to:

```ts
      queryClient.invalidateQueries({ queryKey: ["remaining-project-days", projectId] });
```

Change the description copy:

```tsx
          <DialogDescription>
            Remaining working hours are split evenly across the QA members you select.
          </DialogDescription>
```

to:

```tsx
          <DialogDescription>
            Remaining working days are split evenly across the QA members you select.
          </DialogDescription>
```

Change the remaining-days display:

```tsx
            {selectedProject && (
              <p className="text-xs text-muted-foreground">
                Remaining hours for this item:{" "}
                {remainingHours !== undefined ? `${Math.round(remainingHours * 10) / 10} hrs` : "..."}
              </p>
            )}
```

to:

```tsx
            {selectedProject && (
              <p className="text-xs text-muted-foreground">
                Remaining days for this item:{" "}
                {remainingDays !== undefined ? `${Math.round(remainingDays * 2) / 2} days` : "..."}
              </p>
            )}
```

Change the preview line:

```tsx
          {previewHoursPerWeek !== null && (
            <p className="text-sm text-muted-foreground">
              Each selected QA gets ~{previewHoursPerWeek.toFixed(1)} hrs/week.
            </p>
          )}
```

to:

```tsx
          {previewDaysPerWeek !== null && (
            <p className="text-sm text-muted-foreground">
              Each selected QA gets ~{previewDaysPerWeek.toFixed(1)} days/week.
            </p>
          )}
```

- [ ] **Step 3: `src/components/allocations/rebaseline-dialog.tsx`**

Change the state:

```ts
  const [hoursPerWeek, setHoursPerWeek] = useState(String(allocation.hours_per_week));
```

to:

```ts
  const [daysPerWeek, setDaysPerWeek] = useState(String(allocation.days_per_week));
```

Change the mutation:

```ts
        ? updateAllocation(allocation.id, {
            user_id: allocation.user_id,
            project_id: allocation.project_id,
            role_on_project: allocation.role_on_project,
            hours_per_week: Number(hoursPerWeek),
            start_date: startDate,
            end_date: endDate || undefined,
            priority,
          })
        : proposeAllocationChange(allocation.id, {
            hours_per_week: Number(hoursPerWeek),
            start_date: startDate,
            end_date: endDate || undefined,
            priority,
          }),
```

to:

```ts
        ? updateAllocation(allocation.id, {
            user_id: allocation.user_id,
            project_id: allocation.project_id,
            role_on_project: allocation.role_on_project,
            days_per_week: Number(daysPerWeek),
            start_date: startDate,
            end_date: endDate || undefined,
            priority,
          })
        : proposeAllocationChange(allocation.id, {
            days_per_week: Number(daysPerWeek),
            start_date: startDate,
            end_date: endDate || undefined,
            priority,
          }),
```

Change the input field:

```tsx
            <Label htmlFor="rebaseline_hours">Allocated Hours (Weekly)</Label>
            <Input
              id="rebaseline_hours"
              type="number"
              min={1}
              step={1}
              value={hoursPerWeek}
              onChange={(e) => setHoursPerWeek(e.target.value)}
              required
            />
```

to:

```tsx
            <Label htmlFor="rebaseline_days">Allocated Days (Weekly)</Label>
            <Input
              id="rebaseline_days"
              type="number"
              min={0.5}
              step={0.5}
              value={daysPerWeek}
              onChange={(e) => setDaysPerWeek(e.target.value)}
              required
            />
```

- [ ] **Step 4: `src/components/allocations/assignments-table.tsx`**

Change the total calc:

```ts
  const totalAllocated = rows
    .filter((a) => a.approval_status === "approved")
    .reduce((sum, a) => sum + a.hours_per_week, 0);
```

to:

```ts
  const totalAllocated = rows
    .filter((a) => a.approval_status === "approved")
    .reduce((sum, a) => sum + a.days_per_week, 0);
```

Change the table header:

```tsx
              <TableHead className="text-right">Hours/Wk</TableHead>
```

to:

```tsx
              <TableHead className="text-right">Days/Wk</TableHead>
```

Change the row cell:

```tsx
                  <TableCell className="text-right text-sm tabular-nums">
                    {Math.round(allocation.hours_per_week * 10) / 10}
                  </TableCell>
```

to:

```tsx
                  <TableCell className="text-right text-sm tabular-nums">
                    {Math.round(allocation.days_per_week * 2) / 2}
                  </TableCell>
```

Change the footer:

```tsx
                <TableCell className="text-right tabular-nums">{Math.round(totalAllocated * 10) / 10} hrs</TableCell>
```

to:

```tsx
                <TableCell className="text-right tabular-nums">{Math.round(totalAllocated * 2) / 2} days</TableCell>
```

- [ ] **Step 5: `src/components/allocations/allocations-page-content.tsx`**

Change the resource button display:

```tsx
          <span className="text-xs text-muted-foreground">
            {Math.round(r.allocatedHours * 10) / 10}/{r.profile.capacity_hours} hrs
          </span>
```

to:

```tsx
          <span className="text-xs text-muted-foreground">
            {Math.round(r.allocatedDays * 2) / 2}/{r.profile.capacity_days} days
          </span>
```

Change the form wiring:

```tsx
              <AllocationForm
                userId={selected.profile.id}
                userName={selected.profile.name}
                capacityHours={selected.profile.capacity_hours}
                allocatedHours={selected.allocatedHours}
                projects={approvedProjects}
                role={role}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {selected.profile.name} — {Math.round(selected.allocatedHours * 10) / 10}/
                {selected.profile.capacity_hours} hrs avg/week.
              </p>
```

to:

```tsx
              <AllocationForm
                userId={selected.profile.id}
                userName={selected.profile.name}
                capacityDays={selected.profile.capacity_days}
                allocatedDays={selected.allocatedDays}
                projects={approvedProjects}
                role={role}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {selected.profile.name} — {Math.round(selected.allocatedDays * 2) / 2}/
                {selected.profile.capacity_days} days avg/week.
              </p>
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`

Expected: zero errors under `src/components/allocations/`. Errors remain only in Dashboard files (Task 9).

Run: `npx eslint src/components/allocations/allocation-form.tsx src/components/allocations/bulk-assign-dialog.tsx src/components/allocations/rebaseline-dialog.tsx src/components/allocations/assignments-table.tsx src/components/allocations/allocations-page-content.tsx`

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/components/allocations/allocation-form.tsx src/components/allocations/bulk-assign-dialog.tsx src/components/allocations/rebaseline-dialog.tsx src/components/allocations/assignments-table.tsx src/components/allocations/allocations-page-content.tsx
git commit -m "refactor: rename hours fields to days on the Allocation Tool page"
```

---

### Task 9: Dashboard

**Files:**
- Modify: `src/components/dashboard/dashboard-page-content.tsx`
- Modify: `src/components/dashboard/product-demand-pie-chart.tsx`

**Interfaces:**
- Consumes: `Profile.capacity_days`, `ResourceLoadRow.allocatedDays`, `WeeklyDashboard.demandByProduct: { days }` (Task 4).
- Produces: nothing (Dashboard is a leaf; this is the last task with hours references).

- [ ] **Step 1: `src/components/dashboard/dashboard-page-content.tsx`**

Change the rounding helper:

```ts
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
```

to:

```ts
function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}
```

Change the group-section derivation:

```ts
  const groupSections = (qaGroups ?? []).map((group) => {
    const members = resourceLoad.filter((r) => r.profile.qa_group_id === group.id);
    const totalCapacity = members.reduce((sum, r) => sum + r.profile.capacity_hours, 0);
    const totalAllocated = members.reduce((sum, r) => sum + r.allocatedHours, 0);
    const avgAvailable =
      members.length > 0 ? members.reduce((sum, r) => sum + (100 - r.loadPercent), 0) / members.length : 0;
    return { id: group.id, name: group.name, members, totalCapacity, totalAllocated, avgAvailable };
  });
  const unassignedMembers = resourceLoad.filter((r) => r.profile.qa_group_id === null);
  if (unassignedMembers.length > 0) {
    const totalCapacity = unassignedMembers.reduce((sum, r) => sum + r.profile.capacity_hours, 0);
    const totalAllocated = unassignedMembers.reduce((sum, r) => sum + r.allocatedHours, 0);
```

to:

```ts
  const groupSections = (qaGroups ?? []).map((group) => {
    const members = resourceLoad.filter((r) => r.profile.qa_group_id === group.id);
    const totalCapacity = members.reduce((sum, r) => sum + r.profile.capacity_days, 0);
    const totalAllocated = members.reduce((sum, r) => sum + r.allocatedDays, 0);
    const avgAvailable =
      members.length > 0 ? members.reduce((sum, r) => sum + (100 - r.loadPercent), 0) / members.length : 0;
    return { id: group.id, name: group.name, members, totalCapacity, totalAllocated, avgAvailable };
  });
  const unassignedMembers = resourceLoad.filter((r) => r.profile.qa_group_id === null);
  if (unassignedMembers.length > 0) {
    const totalCapacity = unassignedMembers.reduce((sum, r) => sum + r.profile.capacity_days, 0);
    const totalAllocated = unassignedMembers.reduce((sum, r) => sum + r.allocatedDays, 0);
```

Change the four stat cards' units:

```tsx
              {weekly?.totalCapacity ?? 0} <span className="text-sm font-normal text-muted-foreground">hrs/wk</span>
```

to:

```tsx
              {weekly?.totalCapacity ?? 0} <span className="text-sm font-normal text-muted-foreground">days/wk</span>
```

```tsx
              {round2(weekly?.totalAllocated ?? 0)} <span className="text-sm font-normal text-muted-foreground">hrs/wk</span>
```

to:

```tsx
              {roundHalf(weekly?.totalAllocated ?? 0)} <span className="text-sm font-normal text-muted-foreground">days/wk</span>
```

```tsx
              {round2(weekly?.availableCapacity ?? 0)}{" "}
              <span className="text-sm font-normal text-muted-foreground">hrs/wk</span>
```

to:

```tsx
              {roundHalf(weekly?.availableCapacity ?? 0)}{" "}
              <span className="text-sm font-normal text-muted-foreground">days/wk</span>
```

Change the Capacity-by-QA-Group card:

```tsx
                  <h3 className="text-xs font-medium uppercase text-muted-foreground">
                    {group.name} — {group.members.length} QA{group.members.length === 1 ? "" : "s"} ·{" "}
                    {round2(group.totalAllocated)}/{group.totalCapacity} hrs · {Math.round(group.avgAvailable)}% avail
                  </h3>
```

to:

```tsx
                  <h3 className="text-xs font-medium uppercase text-muted-foreground">
                    {group.name} — {group.members.length} QA{group.members.length === 1 ? "" : "s"} ·{" "}
                    {roundHalf(group.totalAllocated)}/{group.totalCapacity} days · {Math.round(group.avgAvailable)}% avail
                  </h3>
```

```tsx
                        <span className="w-24 text-xs text-muted-foreground">
                          {round2(row.allocatedHours)}/{row.profile.capacity_hours} hrs
                        </span>
```

to:

```tsx
                        <span className="w-24 text-xs text-muted-foreground">
                          {roundHalf(row.allocatedDays)}/{row.profile.capacity_days} days
                        </span>
```

- [ ] **Step 2: `src/components/dashboard/product-demand-pie-chart.tsx`**

Change the prop type and slice-building logic:

```tsx
type ProductDemandPieChartProps = {
  data: { productId: string; hours: number }[];
  productNameById: Map<string, string>;
};

export function ProductDemandPieChart({ data, productNameById }: ProductDemandPieChartProps) {
  const top5 = data.slice(0, 5);
  const otherHours = data.slice(5).reduce((sum, d) => sum + d.hours, 0);

  const slices = [
    ...top5.map((d) => ({
      id: d.productId,
      name: productNameById.get(d.productId) ?? "—",
      hours: Math.round(d.hours * 100) / 100,
    })),
    ...(otherHours > 0 ? [{ id: "other", name: "Other", hours: Math.round(otherHours * 100) / 100 }] : []),
  ];
```

to:

```tsx
type ProductDemandPieChartProps = {
  data: { productId: string; days: number }[];
  productNameById: Map<string, string>;
};

export function ProductDemandPieChart({ data, productNameById }: ProductDemandPieChartProps) {
  const top5 = data.slice(0, 5);
  const otherDays = data.slice(5).reduce((sum, d) => sum + d.days, 0);

  const slices = [
    ...top5.map((d) => ({
      id: d.productId,
      name: productNameById.get(d.productId) ?? "—",
      days: Math.round(d.days * 2) / 2,
    })),
    ...(otherDays > 0 ? [{ id: "other", name: "Other", days: Math.round(otherDays * 2) / 2 }] : []),
  ];
```

Change the chart's `dataKey` and tooltip:

```tsx
          <Pie data={slices} dataKey="hours" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
            {slices.map((slice, index) => (
              <Cell key={slice.id} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => `${value} hrs`} />
```

to:

```tsx
          <Pie data={slices} dataKey="days" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
            {slices.map((slice, index) => (
              <Cell key={slice.id} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => `${value} days`} />
```

- [ ] **Step 3: Verify — the whole app compiles clean**

Run: `npx tsc --noEmit`

Expected: zero errors, anywhere.

Run: `npx eslint`

Expected: zero errors/warnings, anywhere (this runs across the whole project since no path is given).

Run: `npm run build`

Expected: `✓ Compiled successfully` and a completed static/dynamic route listing, matching every previous successful build in this project's history.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/dashboard-page-content.tsx src/components/dashboard/product-demand-pie-chart.tsx
git commit -m "refactor: rename hours fields to days on the Dashboard"
```

---

### Task 10: Browser smoke test and finish

**Files:** none (verification only).

**Interfaces:**
- Consumes: the fully-converted app from Tasks 1–9.
- Produces: nothing (terminal task).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background). Wait for `✓ Ready` in the log, then confirm `http://localhost:3000` (or whatever port it lands on if 3000 is already taken) responds.

- [ ] **Step 2: Team page**

Navigate to `/team`. Confirm the table's capacity column reads "Capacity (days/wk)" and shows small numbers like `5` instead of `40`. Open "Add user", confirm the Capacity field is labeled "Capacity (days/wk)", defaults to `5`, and its stepper moves in `0.5` increments (click the native up/down arrows or type `5.25` and confirm the browser flags it invalid on submit since it's not a multiple of 0.5).

- [ ] **Step 3: Project Portfolio page**

Navigate to `/projects`. Confirm the table's "Total Hrs" column now reads "Total Days" with small numbers. Open "New item", pick a start/end date spanning about a month, confirm "Total Working Days" auto-fills to approximately `22` (not a large hours-scale number), and that manually editing it stops further date changes from overwriting it.

- [ ] **Step 4: Allocation Tool page**

Navigate to `/allocations`. Select a QA resource, confirm "Remaining Capacity" reads "X days / week" with a small number. Pick a target project via the search combobox, confirm "Remaining days for this item" appears and the allocate-preview text reads "~X days/week".

- [ ] **Step 5: Approvals page**

Navigate to `/approvals` (as a QA Lead). If there's a pending project proposal, confirm its card's field is labeled "Total Working Days" and pre-fills a small number (~22 for a month-long item). Confirm the "Future Assignment Proposals" and "Pending Allocation Changes" tables show "Days/Wk" columns with small numbers.

- [ ] **Step 6: Dashboard page**

Navigate to `/dashboard`. Confirm all four stat cards show "days/wk" units with small numbers, and the "Capacity by QA Group" card's per-member rows read like "X/Y days" instead of "X/Y hrs". Confirm the Product Demand pie chart's tooltip (hover a slice) reads "X days" instead of "X hrs".

- [ ] **Step 7: Close the browser tab and stop the dev server**

Close any tabs opened for this check; stop the background `npm run dev` process if it isn't the user's own pre-existing server (check its log for a port conflict message first, matching the pattern from earlier in this session — if it reports "Another next dev server is already running," it already exited on its own and there's nothing to stop).

- [ ] **Step 8: Finish the development branch**

Announce and use **superpowers:finishing-a-development-branch** to verify the full commit history on this branch, then present the merge/PR/keep-as-is menu.

---

## Self-Review Notes

- **Spec coverage:** §1 migration → Task 1. §2 rounding convention → applied per-field across Tasks 4 (server-written values), 5–9 (display + `step={0.5}` inputs), and Task 3 (`multipleOf(0.5)`). §3 backend scope (types, calc helpers, schemas, actions, the monthly auto-fill) → Tasks 2–4. §4 frontend scope (every listed file) → Tasks 5–9, one-to-one. §5 rollout (worktree + plan, tsc/eslint/build checks, browser smoke test) → this plan's structure plus Task 10.
- **Type consistency verified:** `getRemainingProjectHours` renamed to `getRemainingProjectDays` consistently in Task 4 (definition) and Task 8 (both call sites: `allocation-form.tsx`, `bulk-assign-dialog.tsx`). `ResourceLoadRow.allocatedDays` renamed consistently in Task 4 (definition) and Task 8/9 (all consumers: `allocations-page-content.tsx`, `dashboard-page-content.tsx`). `AllocationForm`'s `capacityDays`/`allocatedDays` props match their sole caller's (`allocations-page-content.tsx`) updated prop names.
- **Out of scope confirmed unaffected:** `month-calendar.tsx`, `qa-projects-dialog.tsx`, `change-password-dialog.tsx`, and every `qa-group-action.ts`/`product-action.ts`/`settings-action.ts` file were not found to reference hours in the codebase audit and are not touched by this plan.
