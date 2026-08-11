# QA Resource Manager v4 — Design

## Context

This extends the shipped v1–v3 app with a Dashboard redesign, Project Portfolio workflow
changes (PM-hidden hours, required tracking links), and an Allocation Tool overhaul that
replaces manual weekly-hours entry with dates-drive-hours math tied to a project's
*remaining* (unallocated) total hours. Three independent surfaces; internally,
`BulkAssignDialog`'s even-split calculation is also corrected to use remaining hours
instead of a project's full total, since it shares the same underlying bug the Allocation
Tool changes are fixing.

## 1. Dashboard: summary row

Four cards, replacing today's four: **Total QA Capacity**, **Total Allocated** (now
rounded to 2 decimal places), **Available Capacity** (now rounded to 2 decimal places),
**Total Number of Testers** (new — count of active `qa_lead`/`qa_member` resources for
the selected week, i.e. `resourceLoad.length`). **Avg Available Capacity is dropped
entirely** — its per-QA detail lives in the merged card below instead of a single
top-line average.

## 2. Dashboard: merge "Capacity by QA Group" + "Resource Load"

One card, sectioned by QA Group (same visual pattern as the Allocation Tool's resource
picker): each group's header line shows a compact summary — `{name} — {N} QAs ·
{totalAllocated}/{totalCapacity} hrs · {avgAvailable}% avail` — followed by each member's
existing per-person row (name, `{allocatedHours}/{capacityHours} hrs`, `LoadBar`). An
"Unassigned" section appears if any active QA has no group. Both figures were already
computed by the existing `groupStats` derivation (v3) plus the existing flat
`resourceLoad` list (v1) — this is a rendering merge, not a new data need.

## 3. Dashboard: "Top Product Demand" becomes a pie chart, and starts aggregating by product

Today's `topDemand` is actually top-5 **projects** by hours (mislabeled under a
"Product Demand" heading). Turning it into a pie chart is the opportunity to fix that:
`getWeeklyDashboard` drops `topDemand` and instead returns

```ts
demandByProduct: { productId: string; hours: number }[]  // all products with > 0 hours this week, sorted desc
```

computed the same way `hoursByProject` already is, then re-grouped by each project's
`product_id` (projects fetched for the week already carry it). The Dashboard page keeps
its existing `getProducts()` query (previously feeding "Monthly Demand per Project",
which is being removed — see §4) to resolve `productId → name` for pie labels.

No charting library is installed yet. Add `recharts` (the standard shadcn-ecosystem
choice, works cleanly with Next.js client components) and render a `PieChart` with the
top 5 products by hours plus an "Other" slice aggregating the rest, a legend, and a hover
tooltip showing exact hours.

## 4. Dashboard: monthly calendar view

Replaces "Monthly Hours per QA Member" and "Monthly Demand per Project" entirely. A
month-grid calendar (Monday–Sunday weeks, 6 rows to always fully cover the month
including a few leading/trailing days from adjacent months, shown dimmed) where each
**approved** work item overlapping the month renders as a colored bar spanning the days
it's active, split at week boundaries.

New action:

```ts
export async function getProjectsForMonth(year: number, monthIndex0: number): Promise<Project[]>
```

— approved projects where `start_date <= monthEnd AND (end_date IS NULL OR end_date >=
monthStart)`, using the existing `monthRange()` helper for bounds.

New pure helpers in `src/lib/calendar.ts` (unit-verified via the same disposable
`npx tsx` scratch-script convention used for `load.ts`):

```ts
export type CalendarDay = { date: string; inCurrentMonth: boolean };
export type CalendarWeek = CalendarDay[];

/** 6 rows x 7 cols (Mon-Sun) covering the full display grid for a month. */
export function buildCalendarGrid(year: number, monthIndex0: number): CalendarWeek[];

export type CalendarBar = { projectId: string; startCol: number; endCol: number; lane: number };

/**
 * Greedy interval-packing for one week: clips each project's range to the
 * week's [start,end], converts to 0-6 day-of-week columns, and assigns each
 * segment to the lowest lane whose previous segment doesn't overlap it —
 * the standard "calendar event stacking" algorithm.
 */
export function packWeekBars(
  week: CalendarWeek,
  projects: { id: string; start_date: string; end_date: string | null }[],
): CalendarBar[];
```

Rendering caps visible lanes per week at 3; a week with more overlapping items shows a
single `+N more` note rather than growing unboundedly (day-level "+N more" granularity is
out of scope for v4 — see below). Each project gets a stable color by cycling a fixed
8-color palette indexed by a simple hash of its id, so the same project keeps the same
color across the weeks it spans.

## 5. Project Portfolio: PM proposals hide Total Working Hours

`ProjectInput` gains two new required fields (§7). For the **proposal** path only, Total
Working Hours becomes optional at the schema level:

```ts
const ProjectProposalProjectInput = ProjectInput.partial({ total_working_hours: true });
export const ProjectProposalInput = z.object({
  project: ProjectProposalProjectInput,
  allocations: z.array(ProposedAllocationInput).min(1, "Add at least one tester assignment"),
});
```

`proposeProject` writes `total_working_hours: parsed.data.project.total_working_hours ??
0`. `ProposeProjectDialog` removes the Total Working Hours field entirely — PMs never see
or set it.

**QA Lead sets it during approval.** New schema `ApproveProjectProposalInput = z.object({
total_working_hours: z.number().positive(...) })`. `approveProjectProposal` gains a
second parameter:

```ts
export async function approveProjectProposal(projectId: string, input: unknown): Promise<{ success: true }>
```

— parses `input`, and in the same update that flips `approval_status` to `approved` also
sets `total_working_hours` to the Lead-provided value (parallel-limit checks on the
proposal's allocations run unchanged, before either update). The Approvals page's
"Project Proposals" card gains a required number input per pending proposal (each
proposal card becomes its own small component with local input state); **Approve stays
disabled until a positive number is entered.**

## 6. Project Portfolio: no Progress field on create

Both "New Item" (`ProjectFormDialog`, create mode) and "Propose Item"
(`ProposeProjectDialog`, which never had this field to begin with) submit
`progress_percent: 0` without showing an input. `ProjectFormDialog` only renders the
Progress field in **edit** mode, where its existing "locked at 100 once Completed"
behavior is unchanged.

## 7. Project Portfolio: JIRA link and Jiva link

```sql
alter table public.projects
  add column jira_link text not null default '',
  add column jiva_link text not null default '';
```

Following this app's established pattern for fields that could break existing rows (same
approach as `total_working_hours`/`priority` in v2): the DB stays nullable-by-default
(empty string), so the migration can't fail against existing items. **"Required" is
enforced in the Zod schema/form for every create and edit going forward**:

```ts
jira_link: z.string().trim().url("Enter a valid JIRA URL"),
jiva_link: z.string().trim().url("Enter a valid Jiva URL"),
```

on `ProjectInput` — required for QA-Lead direct create/edit, and (per §5's `.partial()`
only naming `total_working_hours`) still required on PM proposals too. `Project` type
gains `jira_link: string; jiva_link: string`. Both form dialogs get the two URL inputs.
`ProjectTable` gets a compact "Links" column: two small icon buttons (JIRA / Jiva,
`ExternalLink` icon) that open the link in a new tab, rendered only when non-empty.

## 8. Allocation Tool: remaining hours + dates-drive-hours

New action:

```ts
export async function getRemainingProjectHours(projectId: string): Promise<number>
```

— `project.total_working_hours` minus the sum, over that project's *approved*
allocations, of `hours_per_week * weeksBetween(start_date, end_date ?? project.end_date)`
(every project has a required `end_date` since v2, so open-ended allocations always have
a concrete fallback bound). Floored at 0.

`AllocationForm` changes:
- Selecting a project fetches and displays its remaining hours ("Remaining hours for this
  item: X hrs").
- Start/End date inputs **default to the selected project's own start_date/end_date**
  when a project is picked, and are clamped (`min`/`max`) to stay within the project's
  range — matching §5/§6's "initial allocation" framing.
- **"Allocated Hours (Weekly)" input is removed.** Instead, once both dates are valid
  (`end >= start`), `hours/week = remainingHours ÷ weeksBetween(start, end)` is computed
  live and shown ("This will allocate ~Y hrs/week").
- **Validation**: if the computed hrs/week would exceed the QA's own remaining weekly
  capacity (`capacityHours − allocatedHours`, already passed into the form), submission
  is blocked with an inline error ("This would need X hrs/week, but this QA only has Y
  hrs/week available — widen the date range or pick a different QA") rather than
  silently over-allocating them. This is a **client-side check only** — consistent with
  how this form has always trusted its own computed `hours_per_week` value (the server
  action doesn't re-derive it, same as v1–v3).
- Submits the computed `hours_per_week` in place of the removed manual input; Role,
  Priority, and the rest of the flow are unchanged.

`BulkAssignDialog` and `createBulkAllocations` (server) both switch from dividing a
project's full `total_working_hours` to dividing its **remaining** hours — reusing
`getRemainingProjectHours` for the client-side live preview, and an equivalent inline
computation server-side in `createBulkAllocations` (which already has the project row and
an admin client in scope, so it queries existing approved allocations directly rather
than calling the cookie-scoped `getRemainingProjectHours`). This prevents the single-QA
and bulk-assign paths from being able to jointly commit more than a project's total hours
between them.

## Out of scope for v4

Day-level "+N more" granularity on the calendar (week-level only); drag-to-reschedule or
click-to-edit on calendar bars (view-only for now); server-side re-validation of the
single-QA form's submitted `hours_per_week` (client-trusted, matching existing
convention); a real product-vs-project data model beyond what §3's regrouping fixes;
changing how `total_working_hours` behaves for QA-Lead-direct project creation (still
required there, only the PM proposal path defers it).
