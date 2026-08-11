# Project Rebaseline — Design

## Context

Today, an approved project's schedule (start/end date, total working days)
and priority can only be changed by a QA Lead, directly and immediately,
through the existing Edit form. Project Managers have no way to request a
schedule change on a project they don't own outright.

This adds a PM-initiated **project rebaseline**: a PM proposes new
Start Date / End Date / Total Working Days / Priority for an approved
project, and the change only takes effect once a QA Lead approves it. This
mirrors an identical pattern already shipped for allocations — a PM's
`proposeAllocationChange` stages a change in `proposed_*` columns, and a QA
Lead's `approveAllocationChange`/`rejectAllocationChange` applies or
discards it. The project rebaseline reuses that exact mechanism, one level
up.

## 1. Data model

New migration `supabase/migrations/0006_project_rebaseline.sql`, adding to
`projects` the same shape of staging columns the `allocations` table
already has:

```sql
alter table public.projects
  add column if not exists proposed_start_date date,
  add column if not exists proposed_end_date date,
  add column if not exists proposed_total_working_days numeric,
  add column if not exists proposed_priority text check
    (proposed_priority is null or proposed_priority in ('low','medium','high','critical')),
  add column if not exists change_proposed_by uuid references public.profiles(id),
  add column if not exists change_requested_at timestamptz;

alter table public.projects add constraint projects_proposed_total_working_days_check
  check (proposed_total_working_days is null or
    (proposed_total_working_days > 0 and
     proposed_total_working_days = round(proposed_total_working_days * 2) / 2));

create index if not exists projects_change_proposed_by_idx
  on public.projects (change_proposed_by) where change_proposed_by is not null;
```

`Project` (`src/lib/project.ts`) gains the matching optional fields:

```ts
proposed_start_date: string | null;
proposed_end_date: string | null;
proposed_total_working_days: number | null;
proposed_priority: Priority | null;
change_proposed_by: string | null;
change_requested_at: string | null;
```

## 2. Schema and server actions (`project-schema.ts` / `project-action.ts`)

New schema, mirroring `AllocationChangeInput`:

```ts
export const ProjectChangeInput = z.object({
  start_date: isoDate,
  end_date: isoDate,
  total_working_days: z
    .number()
    .positive("Total working days must be greater than 0")
    .multipleOf(0.5, "Total working days must be in half-day increments"),
  priority: z.enum(["low", "medium", "high", "critical"]),
});
export type ProjectChangeInput = z.infer<typeof ProjectChangeInput>;
```

New action in `project-action.ts`, mirroring `proposeAllocationChange`:

```ts
export async function proposeProjectChange(id: string, input: unknown): Promise<{ success: true }>
```

- `requireRole(["project_manager"])`.
- Parse `ProjectChangeInput`.
- Fetch the project's `approval_status, proposed_start_date`. Throw if not
  `"approved"` ("Only an approved item can be rebaselined"). Throw if
  `proposed_start_date !== null` ("This item already has a pending change
  awaiting approval").
- Update the row: `proposed_start_date`, `proposed_end_date`,
  `proposed_total_working_days`, `proposed_priority`, `change_proposed_by:
  profile.id`, `change_requested_at: new Date().toISOString()`. Live
  columns are untouched.

No withdraw action — same as the allocation rebaseline, a PM cannot pull
back a submitted change; only the QA Lead's approve/reject resolves it.

## 3. Approval actions (`approval-action.ts`)

```ts
export async function getPendingProjectChanges(): Promise<Project[]>
export async function approveProjectChange(id: string): Promise<{ success: true }>
export async function rejectProjectChange(id: string): Promise<{ success: true }>
```

- `getPendingProjectChanges`: `requireRole(["qa_lead"])`, selects projects
  where `proposed_start_date is not null`, ordered by
  `change_requested_at ascending` — same shape as
  `getPendingAllocationChanges`.
- `approveProjectChange`: `requireRole(["qa_lead"])`. Fetch the row's
  `proposed_*` columns; throw "This item has no pending change" if
  `proposed_start_date` is null. Update: copy each `proposed_*` value onto
  its live column (`start_date`, `end_date`, `total_working_days`,
  `priority`), then null out all six `proposed_*`/`change_*` columns in the
  same update.
- `rejectProjectChange`: `requireRole(["qa_lead"])`. Null out the six
  `proposed_*`/`change_*` columns, live columns untouched.

Neither action re-derives `progress_percent` or touches allocations —
changing a project's schedule/priority doesn't complete it or affect
existing assignment rows.

## 4. PM-side UI

**`project-table.tsx`:** a new icon button in the Action column, gated on
`canPropose && project.approval_status === "approved"` (PM role only — a
QA Lead already has full, immediate edit access via the existing Edit
action, so they don't get this button). Placed alongside the existing
"Assign QA" button, using a `CalendarClock` icon, `aria-label="Rebaseline"`.
Opens a new `ProjectRebaselineDialog`.

The Name column gains a fourth badge state, alongside the existing
"Pending Approval" / "Rejected" ones: when `project.proposed_start_date !==
null`, show a `Badge` reading **"Rebaseline Pending"** (amber, same style
as "Pending Approval").

**New file `src/components/projects/project-rebaseline-dialog.tsx`**,
structurally a trimmed copy of `RebaselineDialog` (PM-only, so no
`isLead` branch — it always calls `proposeProjectChange`):

```tsx
type ProjectRebaselineDialogProps = {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};
```

Fields: Start Date, End Date (both `type="date"`, pre-filled from
`project.start_date`/`project.end_date`), Total Working Days (`type=
"number"`, `step={0.5}`, `min={0.5}`, pre-filled from
`project.total_working_days`), Priority (`Select`, pre-filled from
`project.priority`). `DialogDescription`: "Changes here need QA Lead
approval before they take effect." Submit button label "Propose change".
On success: toast "Change proposed — pending QA Lead approval", invalidate
`["projects"]`, close the dialog.

## 5. QA Lead approval UI (`approvals-page-content.tsx`)

A new card, **"Pending Project Changes"**, structurally identical to the
existing "Pending Allocation Changes" card: for each pending project, a
header row with the project name and Approve/Reject buttons, then a
two-row Current/Proposed table covering Start Date, End Date, Total
Working Days, Priority. Approve calls `approveProjectChange(project.id)`
(toast "Rebaseline applied"); Reject calls `rejectProjectChange(project.id)`
(toast "Rebaseline rejected"). Both invalidate `["approvals"]` and
`["projects"]`, same `invalidateAll()` helper already used by the other
mutations on this page.

## Out of scope

- **No withdraw action** for a PM's own pending project change (matches
  the existing allocation rebaseline's limits).
- **No cross-validation against existing allocations** on the project —
  e.g. approving a shrunk end date does not check whether QA allocations
  already extend past it, or whether a lowered Total Working Days is now
  less than what's already committed. This is the same gap the allocation
  rebaseline already has today; closing it for either flow is a separate
  effort.
- **No interaction with `releaseAllocationsForCompletedProject`** — a
  project's `status` isn't part of the rebaseline fields, so completing a
  project through the normal Edit flow is unaffected by any pending
  rebaseline on it (the stale `proposed_*` values simply remain until a QA
  Lead approves or rejects them; unlike allocations, projects have no
  "clear on completion" step, since rebaseline scope never touches
  `status`).
