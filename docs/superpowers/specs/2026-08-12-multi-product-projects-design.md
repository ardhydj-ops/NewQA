# Multi-Product Projects — Design

## Context

Today `projects.product_id` is a single required FK: one project, one product.
This adds support for a project spanning multiple products. Per the approved
scope, assignment moves from project-level to **project+product level**: a QA
assignment now records which of the project's products it's for, and each
product carries its own full `total_working_days` budget. Summed across a
project's products, its total staffing budget is `total_working_days ×
product count` — matching the original ask ("remaining days ... calculated
as a multiple based on the number of products") — but tracked per-product so
each product's staffing is independently visible.

Single-product projects (still the common case) keep feeling like today's
flow: forms auto-select the one product, no extra clicks.

## 1. Data model & migration

New migration `0008_multi_product_projects.sql`:

```sql
-- Many-to-many join, replacing the single projects.product_id column.
create table public.project_products (
  project_id uuid not null references public.projects(id) on delete cascade,
  product_id uuid not null references public.products(id),
  primary key (project_id, product_id)
);
create index project_products_product_id_idx on public.project_products (product_id);

alter table public.project_products enable row level security;
create policy "Authenticated read" on public.project_products
  for select using (auth.role() = 'authenticated');
-- Writes only via the service-role client from server actions, same pattern
-- as every other table in this app — no insert/update/delete policy needed
-- for the authenticated role.

-- Backfill: every existing project had exactly one product.
insert into public.project_products (project_id, product_id)
select id, product_id from public.projects;

alter table public.projects drop column product_id;

-- Per-product assignment: each allocation now records which product it's for.
alter table public.allocations add column product_id uuid references public.products(id);

-- Backfill: at migration time every project still has exactly one product
-- (the join table row just inserted above), so this is unambiguous.
update public.allocations a
set product_id = pp.product_id
from public.project_products pp
where pp.project_id = a.project_id;

alter table public.allocations alter column product_id set not null;
create index allocations_product_id_idx on public.allocations (product_id);
```

A project having "at least one product" is enforced at the application layer
(same pattern this app already uses for every other business rule — e.g. the
max-parallel-projects check — rather than a DB constraint), by requiring a
non-empty `product_ids` array in `ProjectInput`/`ProjectProposalInput` and
never allowing the last `project_products` row for a project to be removed
via the edit form (see §4).

## 2. Types

`src/lib/project.ts`: `Project` drops `product_id: string`, gains
`product_ids: string[]` (populated via the join on every read).

`src/lib/allocation.ts`: `Allocation` gains `product_id: string`.

## 3. Server actions

**`src/features/project-action.ts`**
- `getProjects(...)`: select becomes
  `.select("*, project_products(product_id)")`, mapped to
  `{ ...row, product_ids: row.project_products.map(pp => pp.product_id) }`.
  The `product_id` filter param becomes an "any of this project's products"
  match via `.select("*, project_products!inner(product_id)").eq("project_products.product_id", productId)`
  (PostgREST nested-resource filtering).
- `createProject`/`updateProject`/`proposeProject`: after the `projects`
  insert/update, replace that project's `project_products` rows (delete +
  re-insert the submitted `product_ids` — simplest correct approach, avoids
  diffing).
- `updateProject`: reject (before writing) if the submitted `product_ids` is
  missing a product that still has an approved allocation against it on this
  project — message: `"Can't remove <product name>: N assignment(s) still reference it."`
  (mirrors the edge-case decision in §6).

**`src/features/product-action.ts`**
- `deleteProduct`'s in-use check switches from
  `.from("projects").eq("product_id", id)` to
  `.from("project_products").eq("product_id", id)`.

**`src/features/allocation-action.ts`** — every function that computes
"committed" or "remaining" days gains a `productId` parameter and an
additional `.eq("product_id", productId)` filter alongside the existing
`.eq("project_id", projectId)`:
- `getRemainingProjectDays(projectId, productId)`
- `getAssignedQaNames(projectId, productId)`
- `createAllocation` / `createBulkAllocations`: `remainingDays` computed
  scoped to `(project_id, product_id)`; the inserted allocation row carries
  the submitted `product_id`.
- `scheduleWeeklyAllocations`: unchanged internally (it already just places
  `totalDays` against a user's open capacity) except the inserted row now
  includes `product_id`, threaded through from its caller.
- `updateAllocation`: `product_id` is immutable after creation (not part of
  rebaseline — rebaseline only ever touched dates/days/priority) — no schema
  change needed here beyond what §"Schemas" below adds for creation.
- `assertWithinParallelLimit` is unaffected — the parallel-projects limit
  counts distinct *projects*, not products, by design.

**`src/features/dashboard-action.ts`**: `getWeeklyDashboard` and
`getRangeDashboard`'s `demandByProduct` grouping simplifies — group directly
by each allocation's own `product_id` instead of joining through the
project's (formerly single) product. Drops the intermediate `getProjectsByIds`
call these functions currently make solely to look up `project.product_id`.

## 4. Schemas

**`src/features/project-schema.ts`**
- `ProjectInput.product_id` → `product_ids: z.array(z.string().uuid()).min(1, "Select at least one product")`.
- `ProposedAllocationInput` gains `product_id: z.string().uuid("Select a product")`.

**`src/features/allocation-schema.ts`**
- `AllocationInput`, `BulkAllocationInput`, `ScheduleAllocationInput` each
  gain `product_id: z.string().uuid("Select a product")`.

## 5. UI — project forms & table

- `project-form-dialog.tsx` / `propose-project-dialog.tsx`: the single
  Product `<Select>` becomes a multi-select checklist popover — same
  Popover+`Command`+checkbox building blocks as `QaMonthFilter` (§ built in
  the QA-filtered-calendar feature), applied to products instead of testers.
  Requires at least one selection to submit.
- `propose-project-dialog.tsx`'s "Tester Assignments" rows each gain a
  Product `<Select>` scoped to the products just selected above (disabled/
  empty until at least one product is chosen; auto-selected when there's
  only one).
- `project-table.tsx`: the "Products" column (header is already plural)
  renders one `Badge` per `project.product_ids`.
- `projects-page-content.tsx`: Product filter dropdown stays single-select
  (per your answer) and is passed through to `getProjects` unchanged in
  shape; the `"product"` sort comparator sorts by each project's product
  names joined with ", ".
- `project-summary-cards.tsx`: "By Product" pie chart iterates
  `project.product_ids` (one increment per product) instead of the single
  `project.product_id`.

## 6. UI — assignment forms

- `allocation-form.tsx` and `bulk-assign-dialog.tsx`: once a project is
  picked, a new Product `<Select>` appears, populated from that project's
  `product_ids` (cross-referenced against the already-loaded products list).
  Auto-selected and hidden when the project has exactly one product — the
  common case stays a one-fewer-field form, unchanged from today. "Remaining
  days for this item" and "Already assigned" both re-fetch scoped to the
  chosen `(project, product)` pair.
- `assignments-table.tsx` ("Current Assignments" on the Allocation Tool
  page): add a Product column so a multi-product project's assignments are
  distinguishable at a glance.
- `rebaseline-dialog.tsx`: no change — rebaseline never touches project or
  product.

## 7. UI — approvals

- `approvals-page-content.tsx` / `ProjectProposalCard`: the `productName`
  prop (singular) becomes `productNames: string[]`, rendered as multiple
  badges. The card's proposed-assignments mini table gains a Product column
  per row (sourced from each proposed allocation's `product_id`).

## 8. Edge cases

- **Removing a product from an in-use project**: blocked server-side (see
  §3) with a clear error naming the product and how many assignments still
  reference it. The QA Lead must reassign or remove those allocations first.
- **Deleting a project**: `project_products` rows cascade-delete
  automatically (`on delete cascade`), same as `allocations` already does.
- **Deleting a product still referenced by any project**: unchanged
  behavior — blocked, just re-pointed at `project_products` instead of
  `projects`.
- **Single-product projects**: fully backward-compatible in behavior — one
  product means one (auto-selected) choice everywhere a picker appears, so
  existing users see no added friction.

## 9. Testing

No automated test suite exists in this repo (consistent with every other
feature so far). Verification is manual: run the dev server, exercise a
single-product project end-to-end (unchanged flow), then a multi-product
project — create with 2+ products, assign different testers to different
products, confirm each product's "Remaining days" is independent, confirm
the Dashboard's Product Demand and Project Portfolio's By Product charts
reflect per-product data correctly — plus `npx tsc --noEmit` staying clean
throughout.
