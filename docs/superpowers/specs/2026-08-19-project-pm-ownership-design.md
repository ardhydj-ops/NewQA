# Project PM Ownership — Design

## Summary

Every project can carry a Project Manager "owner" — a new `pm_id` field,
distinct from `proposed_by` (which tracks who submitted a proposal, and
isn't always a PM — a QA Lead can be `proposed_by` via New Item or the
Excel import). A PM submitting a proposal is automatically set as its
`pm_id`. Projects without one can be assigned/reassigned by Head of QA,
QA Lead, or any PM directly from a new "PM Name" column on the Project
Portfolio table. When a PM logs in, the table defaults to sorting their
own projects first.

As part of this, the "Tester Assignments" section is removed from the
PM's Propose Item dialog entirely — a proposal is now just project
details + PM ownership; QA assignment happens later via the existing
"Assign QA" action once the project is approved.

## Data Model

```sql
alter table projects
  add column pm_id uuid references profiles(id);
```

Nullable — `null` means unassigned. `Project` type
(`src/lib/project.ts`) gains `pm_id: string | null`.

## Propose Item Changes

`src/components/projects/propose-project-dialog.tsx`:
- The entire "Tester Assignments" section (rows, Add tester button,
  per-row Tester/Product/Role/Days-Wk/Start/End fields) is removed.
- No more `getQaLeadCandidates`/`getQaGroups`/`getProducts`-for-testers
  logic — `products` is still fetched (still needed for the Products
  multi-select field on the project itself), but nothing related to
  resolving a tester.
- Submission no longer sends an `allocations` array with content; the
  action call becomes just `proposeProject({ project: {...} })` (or
  sends `allocations: []` if the schema keeps the field — see below).

`src/features/project-schema.ts`:
- `ProjectProposalInput.allocations` changes from
  `z.array(ProposedAllocationInput).min(1, "Add at least one tester assignment")`
  to `z.array(ProposedAllocationInput).default([])` — optional, defaults
  to empty. `ProposedAllocationInput` itself is unchanged (still used by
  the post-approval "Assign QA" flow elsewhere).

`src/features/project-action.ts` (`proposeProject`):
- Sets `pm_id: profile.id` on the inserted project row (the submitting
  PM).
- Guards the allocations insert with `if (parsed.data.allocations.length > 0)`
  before calling `.insert(...)` — skips the call entirely when empty,
  since the array will now always be empty from this dialog (defensive:
  avoids relying on how PostgREST handles a zero-row bulk insert).

Projects created via QA Lead's "New Item" (`createProject`) or the Excel
import (`importProjectSchedule`) leave `pm_id` unset (`null`) — those
paths have no submitting PM to attribute it to.

## PM Assignment (new/reassignable)

New server action, `src/features/project-action.ts`:
```ts
export async function assignProjectPm(projectId: string, pmId: string | null): Promise<{ success: true }>;
```
- `requireRole([...QA_LEAD_ROLES, "project_manager"])`.
- No restriction on whose id can be set — any PM, not just self;
  `pmId: null` clears it back to unassigned.
- Immediate write via the admin client, no approval workflow (matches
  how QA Group assignment on Team Management works today — an
  ownership-tag change, not a schedule/scope change).

New helper, `src/features/profile-action.ts`:
```ts
export async function getProjectManagers(): Promise<Profile[]>;
```
Active profiles with `role: "project_manager"`, mirroring
`getQaLeadCandidates()`'s shape — used to populate the assignment
dropdown.

## "PM Name" Column

`src/components/projects/project-table.tsx`:
- New sortable column, placed right after "Name".
- For `qa_member` viewers: plain text — the PM's name, or "—" if
  `pm_id` is null.
- For QA Lead / Head of QA / Project Manager viewers: a `<Select>`
  (matching the existing Status/Priority column-adjacent dropdown
  style used elsewhere in this app, not a searchable combobox — the PM
  roster is expected to be small) with options "Unassigned" + every
  active PM from `getProjectManagers()`. Changing it calls
  `assignProjectPm` immediately (optimistic-free — invalidate the
  `["projects"]` query on success, same pattern as every other inline
  mutation in this table).

`src/components/projects/projects-page-content.tsx`:
- Fetches `getProfiles()` (for a `pmNameById` display map covering even
  inactive/historical PMs) and `getProjectManagers()` (for the dropdown's
  assignable options) alongside the existing product/QA-group queries.

## Sorting

`src/components/projects/project-table.tsx` (`ProjectSortKey`):
- New key `"pm"` added to the existing union
  (`name | assigned | product | progress | start_date | end_date | total_days | type | status | priority`).
- Comparator: primary — whether the row's `pm_id` equals the *viewing*
  PM's own id (0 if so, 1 otherwise; irrelevant/always-equal when the
  viewer isn't a PM, so it has no effect for non-PM viewers), secondary
  — the resolved PM name alphabetically (via `pmNameById`, unassigned
  sorting last), same ascending/descending toggle behavior as every
  other column.
- New sortable header "PM Name", wired the same way as the other
  `SortableHeader` columns.

`src/components/projects/projects-page-content.tsx`:
- Initial `sortKey` state becomes role-dependent:
  `useState<ProjectSortKey>(() => (role === "project_manager" ? "pm" : "assigned"))`.
  Clicking any column header (including "PM Name" itself, or any other
  column) replaces this default the same way clicking a header today
  overrides the existing default "Assigned" sort — no special
  "always-pinned" behavior.

## Testing (manual — this repo has no automated test suite)

1. As a PM, submit a proposal via Propose Item → confirm there's no
   Tester Assignments section at all, and submission succeeds with just
   project details.
2. As Head of QA/QA Lead, approve that proposal → confirm the approved
   project's "PM Name" column shows the submitting PM's name.
3. As QA Lead, create a project via "New Item" → confirm its "PM Name"
   shows "Unassigned" / "—".
4. As Head of QA, assign a PM to that unassigned project via the PM Name
   dropdown → confirm it updates immediately and persists on reload.
5. As a different PM, reassign that same project to yourself → confirm
   it succeeds (no self-only restriction).
6. Log in as a PM with several of their own projects mixed among
   others' → confirm the Project Portfolio initially sorts their own
   projects first. Click a different column header → confirm normal
   sorting takes over. Reload the page → confirm it defaults back to
   PM-first sort.
7. Confirm a QA Member sees the PM Name column as read-only text, no
   dropdown.
8. Confirm the Excel-imported project-schedule flow still works and
   leaves `pm_id` null (unaffected by this feature).
