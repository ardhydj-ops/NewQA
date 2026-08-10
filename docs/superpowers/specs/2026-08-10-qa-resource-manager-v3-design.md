# QA Resource Manager v3 — Design

## Context

This extends the shipped v1+v2 app (`docs/superpowers/specs/2026-08-06-qa-resource-manager-design.md`,
`docs/superpowers/specs/2026-08-10-qa-resource-manager-v2-design.md`) with five changes: a
project-level assignment view, a date-range planning period on the Allocation Tool, CRUD-managed
QA Groups and Products, QA-Group-grouped resource picking, and a QA-count column on the dashboard's
group breakdown. Items 1, 2, 4, and 5 are independent of each other; item 3 (QA Groups/Products
CRUD) is a prerequisite for items 4 and 5, since both consume the now-dynamic group list.

## 1. Project Portfolio: view assigned QAs

New read-only action:

```ts
export async function getAllocationsForProject(projectId: string): Promise<Allocation[]>
```

Any authenticated user may call it (read, cookie-scoped client — same pattern as
`getAllocationsForUser`).

Project Portfolio's table gains an "Assigned" column, shown for every role (unlike the existing
Actions column, which is QA-Lead/PM only): a badge reading `N QA(s)` (or `— ` when zero). Clicking
it opens a `ProjectAssignmentsDialog` — a read-only table of that project's allocations: QA name,
role on project, hours/week, priority, timeline, and approval status badge (mirroring the
pending/rejected/pending-change badges already used in `AssignmentsTable`). The dialog fetches its
own profile list via the existing `getProfiles()` (`@/features/profile-action`, already used by
Team Management) to build an `id → name` lookup for the allocations it receives — no new profile
action needed. No write actions in this dialog.

## 2. Allocation Tool: date-range planning period

"Planning week of" (single `<input type="date">`) becomes "Planning period": two date inputs,
Start and End, defaulting to the current ISO week (Monday–Sunday) on first load — identical default
to today's behavior. The Dashboard page's own "Week of" picker is unchanged; this only touches
`/allocations`.

New action, parallel to `getWeeklyDashboard`:

```ts
export async function getRangeDashboard(startDateISO: string, endDateISO: string): Promise<WeeklyDashboard>
```

Same `WeeklyDashboard` return shape (`totalCapacity`, `totalAllocated`, `availableCapacity`,
`resourceLoad`, `topDemand`) so the Allocation Tool's existing resource-list rendering,
`AllocationForm`'s remaining-capacity line, and `LoadBar` usage need no changes beyond the data
source. The only behavioral difference is how `allocatedHours` is computed per QA: instead of
summing `hours_per_week` for allocations overlapping one fixed week, it's

```
allocatedHours = totalOverlapHoursInRange(user) / weeksBetween(startDateISO, endDateISO)
```

— i.e. average hours/week over however many weeks the picked range spans. `totalOverlapHoursInRange`
reuses the existing day-prorated overlap logic (`hours_per_week / 7 * overlapDays`), the same
convention `monthlyHoursForUser` already uses, just generalized to an arbitrary range instead of a
calendar month. `weeksBetween` already exists (`src/lib/load.ts`, added in v2). A new pure helper,
`rangeHoursForUser(allocations, userId, range): number`, is added next to `monthlyHoursForUser` for
this (same prorated-day-overlap math, different range type). `loadPercent` is computed exactly as
before (`weeklyLoadPercent(allocatedHours, capacityHours)`) — the "average hrs/week" framing means
existing thresholds (80%/100%) still apply unchanged. `topDemand` sums the same
average-hours-per-week per project instead of raw weekly sum.

Validation: End date must be on or after Start date (client-side check on the two inputs, same
inline-required-field pattern as elsewhere — no submit if invalid).

## 3. Settings: QA Groups & Products CRUD

Both become real lookup tables instead of hardcoded enums:

```sql
create table public.qa_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles add column qa_group_id uuid references public.qa_groups(id);
alter table public.projects add column product_id uuid references public.products(id);
```

Migration seeds both tables with today's five QA Group labels (QRIS H2H, QRIS BO, Digital H2H,
Digital BO, Corporate IT) and six Product labels (QRIS H2H, QRIS BO, QRCB, PI, JV, CCW), backfills
`qa_group_id`/`product_id` on existing rows by matching the old enum value to the seeded row's
`name`, then drops `profiles.qa_group` and `projects.product` (the old `text` + check-constraint
columns) entirely — this is a full cutover, not a soft/dual-write migration, since both old columns
are fully superseded and every consumer is updated in the same change. `product_id` is `not null`
after backfill (product was already required); `qa_group_id` stays nullable (QA Group was already
optional per profile).

Type changes: `QaGroup`/`Product` union types are deleted from `src/lib/profile.ts` /
`src/lib/project.ts`. `Profile.qa_group_id: string | null` and `Project.product_id: string` replace
`qa_group`/`product`. New types `QaGroupRow = { id: string; name: string }` and
`ProductRow = { id: string; name: string }` live in new `src/lib/qa-group.ts` / `src/lib/product.ts`.

New actions, `src/features/qa-group-action.ts` and `src/features/product-action.ts` (identical
shape, one per entity):

```ts
export async function getQaGroups(): Promise<QaGroupRow[]>       // any authenticated user
export async function createQaGroup(input: unknown): Promise<{ success: true }>   // qa_lead only
export async function updateQaGroup(id: string, input: unknown): Promise<{ success: true }> // qa_lead only
export async function deleteQaGroup(id: string): Promise<{ success: true }>       // qa_lead only
```

`QaGroupInput`/`ProductInput` Zod schemas: `{ name: z.string().trim().min(1) }`. Create/update
surface the DB's unique-constraint violation as a friendly "A QA Group with that name already
exists" error (same `catch (error) → throw new Error(...)` pattern used elsewhere for Supabase
errors, matched on the Postgres unique-violation code `23505`).

`deleteQaGroup`/`deleteProduct` count references before deleting:

```ts
const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("qa_group_id", id);
if (count && count > 0) throw new Error(`Can't delete: ${count} QA(s) are still in this group`);
```

(analogous `projects`/`product_id` count for products, message `"Can't delete: N project(s) use
this product"`).

Settings page gains two new cards below "Max Parallel Projects": "QA Groups" and "Products", each a
plain list (Name + row actions) with an "Add" button opening a small name-only dialog, row Edit
(same dialog, pre-filled) and Delete (`AlertDialog` confirm, same pattern as Project Portfolio's
delete confirm) — mirroring Team Management's list+dialog structure at a smaller scale (no roles,
no capacity, just a name).

**Every existing consumer of the old hardcoded label maps switches to resolving names from these
tables**, fetched once per page via `getQaGroups()`/`getProducts()` and turned into an
`id → name` `Map` for lookups:
- `team-form-dialog.tsx` / `team-table.tsx`: QA Group `<Select>` sourced from `getQaGroups()`;
  table shows the resolved name instead of `QA_GROUP_LABEL[profile.qa_group]`.
- `project-form-dialog.tsx` / `propose-project-dialog.tsx`: Product `<Select>` sourced from
  `getProducts()`.
- `project-table.tsx`: Product badge resolved via the id→name map; `projects-page-content.tsx`'s
  product filter `<Select>` populated from `getProducts()`.
- `dashboard-page-content.tsx`: the "Capacity by QA Group" table (added last turn) iterates
  `getQaGroups()` results instead of the hardcoded `QA_GROUP_ORDER`/`QA_GROUP_LABEL`.

No new role or permission model — QA-Lead-only for mutations follows the same `requireRole`
pattern already used everywhere else.

## 4. Allocation Tool: group the QA list by QA Group

Depends on §3. The "Select Resource" search panel's flat list becomes sectioned: one heading per
QA Group (from `getQaGroups()`, alphabetical by name) followed by its members' existing resource
cards, plus a trailing "Unassigned" section for any active QA with `qa_group_id === null`. The
search box keeps filtering by name across all sections — a group section that ends up empty after
filtering is hidden entirely, same "no results" fallback as today when every section is empty.

## 5. Dashboard: QA count on the group breakdown table

Depends on §3. The "Capacity by QA Group" table (added last turn) gains a "# QAs" column between
QA Group and Total Capacity, showing `members.length` for that group in the selected week — already
computed as part of the existing `groupStats` derivation, just rendered as an extra column.

## Out of scope for v3

Nested/hierarchical QA Groups, per-product or per-group custom settings beyond a name, bulk
rename/merge tooling, an audit trail of QA Group/Product changes, changing what "QA Group" or
"Product" *mean* conceptually (still simple name-only categorization), and any change to the
Dashboard page's own week-based (non-range) picker.
