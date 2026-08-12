# Multi-Product Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a project span multiple products, with QA assignment moved to the (project, product) level so each product carries its own full `total_working_days` "Remaining days" budget — matching the ask that a project's total staffing scales as a multiple of its product count.

**Architecture:** A new `project_products` join table replaces the single `projects.product_id` column. A new `allocations.product_id` column records which product each assignment is for. Every server action that reads/writes projects or computes remaining/committed days is extended to carry `product_ids` (projects) or `product_id` (allocations). UI pickers for products become multi-select (projects) or a scoped single-select that appears only when a project has more than one product (assignments) — so the common single-product case stays a one-field-fewer form, unchanged from today.

**Tech Stack:** Next.js App Router, Supabase (`@supabase/ssr` server client, `@supabase/supabase-js` service-role admin client, PostgREST embedded-resource queries), TanStack React Query v5, Zod, shadcn/ui (`Command`, `Popover`, `Select`, `Badge`), TypeScript.

## Global Constraints

- A project must have at least one product — enforced at the application layer (Zod `min(1)` on the client-submitted array, never a DB constraint), same pattern this app already uses for every other business rule.
- Removing a product from a project is blocked server-side while an *approved* allocation on that project still references it (see Task 4).
- Assignment `product_id` is immutable after creation — never touched by rebaseline (dates/days/priority only).
- The max-parallel-projects limit (`assertWithinParallelLimit`) stays scoped to distinct *projects*, not products — unaffected by this feature.
- No automated test suite exists in this repo (no test script in `package.json`, no `*.test.*`/`*.spec.*` files). Verification is `npx tsc --noEmit` after every task, plus a full manual pass in the final task — do not introduce a new test framework.
- Single-product projects (today's only case) must keep behaving exactly as they do now: forms auto-select the one product with no extra required click.

---

### Task 1: Migration

**Files:**
- Create: `supabase/migrations/0008_multi_product_projects.sql`

**Interfaces:**
- Produces: `project_products (project_id, product_id)` table and `allocations.product_id` column, consumed by every task below.

- [ ] **Step 1: Write the migration**

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

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push` (or however this repo's existing migrations have been applied — check `supabase/migrations/README` or ask if unsure; do not skip applying it, later tasks assume the schema is live).
Expected: migration applies with no errors; `select * from project_products limit 1;` and `select product_id from allocations limit 1;` both succeed in the Supabase SQL editor.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0008_multi_product_projects.sql
git commit -m "feat: add project_products join table and allocations.product_id"
```

---

### Task 2: Types

**Files:**
- Modify: `src/lib/project.ts`
- Modify: `src/lib/allocation.ts`

**Interfaces:**
- Produces: `Project.product_ids: string[]` (replacing `product_id: string`), `Allocation.product_id: string`. Consumed by every task below.

- [ ] **Step 1: Update `Project`**

In `src/lib/project.ts`, replace:

```ts
  product_id: string;
```

with:

```ts
  product_ids: string[];
```

- [ ] **Step 2: Update `Allocation`**

In `src/lib/allocation.ts`, add a field after `project_id: string;`:

```ts
  project_id: string;
  product_id: string;
```

- [ ] **Step 3: Type-check (expect failures)**

Run: `npx tsc --noEmit`
Expected: many errors across the codebase referencing `.product_id` on projects and missing `product_id` on allocation inputs — this is expected; every subsequent task fixes one cluster of these. Do not try to fix them all here.

- [ ] **Step 4: Commit**

```bash
git add src/lib/project.ts src/lib/allocation.ts
git commit -m "feat: add product_ids/product_id to Project and Allocation types"
```

---

### Task 3: Schemas

**Files:**
- Modify: `src/features/project-schema.ts`
- Modify: `src/features/allocation-schema.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ProjectInput.product_ids: string[]`, `ProposedAllocationInput.product_id: string`, `AllocationInput.product_id`, `BulkAllocationInput.product_id`, `ScheduleAllocationInput.product_id`. Consumed by Tasks 4 and 7.

- [ ] **Step 1: Update `project-schema.ts`**

Replace:

```ts
  product_id: z.string().uuid("Select a product"),
```

with:

```ts
  product_ids: z.array(z.string().uuid()).min(1, "Select at least one product"),
```

Add a field to `ProposedAllocationInput` (after `user_id`):

```ts
export const ProposedAllocationInput = z.object({
  user_id: z.string().uuid("Select a tester"),
  product_id: z.string().uuid("Select a product"),
  role_on_project: z.string().trim().min(1, "Role on project is required"),
```

- [ ] **Step 2: Update `allocation-schema.ts`**

Add `product_id: z.string().uuid("Select a product"),` (after `project_id`) to each of `AllocationInput`, `BulkAllocationInput`, and `ScheduleAllocationInput`:

```ts
export const AllocationInput = z.object({
  user_id: z.string().uuid("Select a tester"),
  project_id: z.string().uuid("Select a project"),
  product_id: z.string().uuid("Select a product"),
  role_on_project: z.string().trim().min(1, "Role on project is required"),
  ...
```

```ts
export const BulkAllocationInput = z.object({
  project_id: z.string().uuid("Select a project"),
  product_id: z.string().uuid("Select a product"),
  user_ids: z.array(z.string().uuid()).min(1, "Select at least one QA member"),
  ...
```

```ts
export const ScheduleAllocationInput = z.object({
  user_id: z.string().uuid("Select a tester"),
  project_id: z.string().uuid("Select a project"),
  product_id: z.string().uuid("Select a product"),
  role_on_project: z.string().trim().min(1, "Role on project is required"),
  ...
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: fewer errors than Task 2 left, but still many in `project-action.ts`/`allocation-action.ts` — expected, fixed in Tasks 4 and 7.

- [ ] **Step 4: Commit**

```bash
git add src/features/project-schema.ts src/features/allocation-schema.ts
git commit -m "feat: add product_ids/product_id to project and allocation schemas"
```

---

### Task 4: `project-action.ts`

**Files:**
- Modify: `src/features/project-action.ts`

**Interfaces:**
- Consumes: `Project` (Task 2), `ProjectInput`/`ProjectProposalInput` (Task 3).
- Produces: `getProjects` returns `Project[]` with `product_ids` populated; `createProject`/`updateProject`/`proposeProject` write to `project_products`. Consumed by every project-listing UI task below.

- [ ] **Step 1: Add the `AdminClient` type alias and a `setProjectProducts` helper**

Add near the top of the file, after the imports:

```ts
type AdminClient = ReturnType<typeof createAdminClient>;

async function setProjectProducts(admin: AdminClient, projectId: string, productIds: string[]): Promise<void> {
  const { error: deleteError } = await admin.from("project_products").delete().eq("project_id", projectId);
  if (deleteError) throw new Error(deleteError.message);

  const { error: insertError } = await admin
    .from("project_products")
    .insert(productIds.map((productId) => ({ project_id: projectId, product_id: productId })));
  if (insertError) throw new Error(insertError.message);
}
```

- [ ] **Step 2: Rewrite `getProjects`**

Replace the whole function:

```ts
export async function getProjects({
  status = "",
  product_id = "",
  search = "",
  item_type = "",
  priority = "",
  approvalStatus,
}: {
  status?: ProjectStatus | "";
  product_id?: string;
  search?: string;
  item_type?: ItemType | "";
  priority?: Priority | "";
  approvalStatus?: ApprovalStatus;
} = {}): Promise<Project[]> {
  const supabase = await createClient();

  let query = supabase.from("projects").select("*, project_products(product_id)");

  const term = search.trim();
  if (term) query = query.ilike("name", `%${term}%`);
  if (status) query = query.eq("status", status);
  if (item_type) query = query.eq("item_type", item_type);
  if (priority) query = query.eq("priority", priority);
  if (approvalStatus) query = query.eq("approval_status", approvalStatus);

  if (product_id) {
    const { data: matches, error: matchError } = await supabase
      .from("project_products")
      .select("project_id")
      .eq("product_id", product_id);
    if (matchError) throw new Error(matchError.message);
    const projectIds = (matches ?? []).map((m) => m.project_id);
    if (projectIds.length === 0) return [];
    query = query.in("id", projectIds);
  }

  const { data, error } = await query.order("start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const { project_products, ...project } = row as Project & { project_products: { product_id: string }[] };
    return { ...project, product_ids: project_products.map((pp) => pp.product_id) };
  });
}
```

- [ ] **Step 3: Rewrite `createProject`**

Replace the whole function:

```ts
export async function createProject(input: unknown): Promise<{ success: true }> {
  await requireRole(QA_LEAD_ROLES);

  const parsed = ProjectInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { data: project, error } = await admin
    .from("projects")
    .insert({
      name: parsed.data.name,
      item_type: parsed.data.item_type,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      status: parsed.data.status,
      progress_percent: parsed.data.status === "completed" ? 100 : parsed.data.progress_percent,
      total_working_days: parsed.data.total_working_days,
      priority: parsed.data.priority,
      jira_link: parsed.data.jira_link,
      jiva_link: parsed.data.jiva_link,
      approval_status: "approved",
    })
    .select("id")
    .single();

  if (error || !project) throw new Error(error?.message ?? "Failed to create item");

  await setProjectProducts(admin, project.id, parsed.data.product_ids);
  return { success: true };
}
```

- [ ] **Step 4: Rewrite `updateProject`**

Replace the whole function:

```ts
export async function updateProject(id: string, input: unknown): Promise<{ success: true }> {
  await requireRole(QA_LEAD_ROLES);

  const parsed = ProjectInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const becomingCompleted = parsed.data.status === "completed";

  const { data: currentProducts, error: currentError } = await admin
    .from("project_products")
    .select("product_id")
    .eq("project_id", id);
  if (currentError) throw new Error(currentError.message);

  const removedProductIds = (currentProducts ?? [])
    .map((p) => p.product_id)
    .filter((productId) => !parsed.data.product_ids.includes(productId));

  if (removedProductIds.length > 0) {
    const { data: stillAssigned, error: assignedError } = await admin
      .from("allocations")
      .select("product_id")
      .eq("project_id", id)
      .eq("approval_status", "approved")
      .in("product_id", removedProductIds);
    if (assignedError) throw new Error(assignedError.message);
    if (stillAssigned && stillAssigned.length > 0) {
      const { data: product } = await admin
        .from("products")
        .select("name")
        .eq("id", stillAssigned[0].product_id)
        .single();
      throw new Error(
        `Can't remove ${product?.name ?? "this product"}: ${stillAssigned.length} assignment(s) still reference it.`,
      );
    }
  }

  const { error } = await admin
    .from("projects")
    .update({
      name: parsed.data.name,
      item_type: parsed.data.item_type,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      status: parsed.data.status,
      progress_percent: becomingCompleted ? 100 : parsed.data.progress_percent,
      total_working_days: parsed.data.total_working_days,
      priority: parsed.data.priority,
      jira_link: parsed.data.jira_link,
      jiva_link: parsed.data.jiva_link,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);

  await setProjectProducts(admin, id, parsed.data.product_ids);

  if (becomingCompleted) {
    await releaseAllocationsForCompletedProject(admin, id);
  }

  return { success: true };
}
```

- [ ] **Step 5: Update `proposeProject`**

Replace the block from the `projects` insert through the `allocations` insert:

```ts
  const { data: project, error: projectError } = await admin
    .from("projects")
    .insert({
      name: parsed.data.project.name,
      item_type: parsed.data.project.item_type,
      start_date: parsed.data.project.start_date,
      end_date: parsed.data.project.end_date,
      status: parsed.data.project.status,
      progress_percent: parsed.data.project.progress_percent,
      total_working_days: parsed.data.project.total_working_days ?? 0,
      priority: parsed.data.project.priority,
      jira_link: parsed.data.project.jira_link,
      jiva_link: parsed.data.project.jiva_link,
      approval_status: "pending",
      proposed_by: profile.id,
    })
    .select("id")
    .single();

  if (projectError || !project) {
    throw new Error(projectError?.message ?? "Failed to submit proposal");
  }

  const { error: productsError } = await admin
    .from("project_products")
    .insert(parsed.data.project.product_ids.map((productId) => ({ project_id: project.id, product_id: productId })));
  if (productsError) {
    await admin.from("projects").delete().eq("id", project.id);
    throw new Error(productsError.message);
  }

  const { error: allocationsError } = await admin.from("allocations").insert(
    parsed.data.allocations.map((allocation) => ({
      user_id: allocation.user_id,
      project_id: project.id,
      product_id: allocation.product_id,
      role_on_project: allocation.role_on_project,
      days_per_week: allocation.days_per_week,
      start_date: allocation.start_date,
      end_date: allocation.end_date ?? null,
      approval_status: "pending",
      proposed_by: profile.id,
    })),
  );

  if (allocationsError) {
    await admin.from("projects").delete().eq("id", project.id);
    throw new Error(allocationsError.message);
  }
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no more errors originating from `project-action.ts` itself (errors in files that consume `Project`/schemas are still expected until their own tasks land).

- [ ] **Step 7: Commit**

```bash
git add src/features/project-action.ts
git commit -m "feat: back Project reads/writes with the project_products join table"
```

---

### Task 5: `approval-action.ts`

**Files:**
- Modify: `src/features/approval-action.ts`

**Interfaces:**
- Consumes: `Project` (Task 2).
- Produces: `getPendingProjectProposals`/`getPendingProjectChanges` return `product_ids`-populated rows.

- [ ] **Step 1: Update `getPendingProjectProposals`**

Replace the function body's query and mapping:

```ts
export async function getPendingProjectProposals(): Promise<PendingProjectProposal[]> {
  await requireRole(QA_LEAD_ROLES);

  const admin = createAdminClient();
  const { data: projects, error } = await admin
    .from("projects")
    .select("*, project_products(product_id)")
    .eq("approval_status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const proposals: PendingProjectProposal[] = [];
  for (const row of projects ?? []) {
    const { project_products, ...project } = row as Project & { project_products: { product_id: string }[] };
    const { data: allocations } = await admin.from("allocations").select("*").eq("project_id", project.id);
    proposals.push({
      ...project,
      product_ids: project_products.map((pp) => pp.product_id),
      allocations: (allocations ?? []) as Allocation[],
    });
  }
  return proposals;
}
```

- [ ] **Step 2: Update `getPendingProjectChanges`**

Replace the whole function:

```ts
export async function getPendingProjectChanges(): Promise<Project[]> {
  await requireRole(QA_LEAD_ROLES);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("projects")
    .select("*, project_products(product_id)")
    .not("proposed_start_date", "is", null)
    .order("change_requested_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const { project_products, ...project } = row as Project & { project_products: { product_id: string }[] };
    return { ...project, product_ids: project_products.map((pp) => pp.product_id) };
  });
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from `approval-action.ts` itself.

- [ ] **Step 4: Commit**

```bash
git add src/features/approval-action.ts
git commit -m "feat: populate product_ids in pending project proposals/changes"
```

---

### Task 6: `product-action.ts`

**Files:**
- Modify: `src/features/product-action.ts`

**Interfaces:**
- Produces: `deleteProduct`'s in-use check reads from `project_products` instead of the now-removed `projects.product_id`.

- [ ] **Step 1: Update `deleteProduct`**

Replace:

```ts
  const { count, error: countError } = await admin
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("product_id", id);
```

with:

```ts
  const { count, error: countError } = await admin
    .from("project_products")
    .select("project_id", { count: "exact", head: true })
    .eq("product_id", id);
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from `product-action.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/features/product-action.ts
git commit -m "fix: check project_products (not projects.product_id) before deleting a product"
```

---

### Task 7: `allocation-action.ts`

**Files:**
- Modify: `src/features/allocation-action.ts`

**Interfaces:**
- Consumes: `AllocationInput`/`BulkAllocationInput`/`ScheduleAllocationInput` (Task 3, all now carry `product_id`).
- Produces: `getRemainingProjectDays(projectId, productId)`, `getAssignedQaNames(projectId, productId)` — both now product-scoped. Consumed by Tasks 14 and 15.

- [ ] **Step 1: Scope `getRemainingProjectDays`**

Replace the whole function:

```ts
export async function getRemainingProjectDays(projectId: string, productId: string): Promise<number> {
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
    .eq("product_id", productId)
    .eq("approval_status", "approved");
  if (error) throw new Error(error.message);

  const committed = (allocations ?? []).reduce(
    (sum, a) => sum + a.days_per_week * weeksBetween(a.start_date, a.end_date ?? project.end_date!),
    0,
  );

  return Math.max(0, project.total_working_days - committed);
}
```

- [ ] **Step 2: Scope `getAssignedQaNames`**

Add `.eq("product_id", productId)` to its allocations query and update the signature:

```ts
export async function getAssignedQaNames(projectId: string, productId: string): Promise<string[]> {
  const supabase = await createClient();

  const { data: allocations, error } = await supabase
    .from("allocations")
    .select("user_id")
    .eq("project_id", projectId)
    .eq("product_id", productId)
    .eq("approval_status", "approved");
  if (error) throw new Error(error.message);
```

(leave the rest of the function body unchanged).

- [ ] **Step 3: Thread `productId` through `scheduleWeeklyAllocations`**

In the function's params type and destructure, add `productId: string;` after `projectId: string;`:

```ts
async function scheduleWeeklyAllocations(params: {
  admin: AdminClient;
  userId: string;
  projectId: string;
  productId: string;
  roleOnProject: string;
  priority: Priority;
  totalDays: number;
  startDateISO: string;
  projectEndDateISO: string;
  isLead: boolean;
  proposedBy: string | null;
}): Promise<ScheduleResult> {
  const {
    admin,
    userId,
    projectId,
    productId,
    roleOnProject,
    priority,
    totalDays,
    startDateISO,
    projectEndDateISO,
    isLead,
    proposedBy,
  } = params;
```

In the same function's `insert` call, add `product_id: productId,` after `project_id: projectId,`:

```ts
      const { error } = await admin.from("allocations").insert({
        user_id: userId,
        project_id: projectId,
        product_id: productId,
        role_on_project: roleOnProject,
        days_per_week: thisWeekDays,
```

- [ ] **Step 4: Scope `createAllocation`**

Add `.eq("product_id", parsed.data.product_id)` to its existing-allocations query, and pass `productId` into the `scheduleWeeklyAllocations` call:

```ts
  const { data: existingProjectAllocations, error: existingError } = await admin
    .from("allocations")
    .select("days_per_week, start_date, end_date")
    .eq("project_id", parsed.data.project_id)
    .eq("product_id", parsed.data.product_id)
    .eq("approval_status", "approved");
```

```ts
  return scheduleWeeklyAllocations({
    admin,
    userId: parsed.data.user_id,
    projectId: parsed.data.project_id,
    productId: parsed.data.product_id,
    roleOnProject: parsed.data.role_on_project,
    priority: parsed.data.priority,
    totalDays: remainingDays,
    startDateISO: parsed.data.start_date,
    projectEndDateISO: project.end_date,
    isLead,
    proposedBy: isLead ? null : profile.id,
  });
```

- [ ] **Step 5: Update `updateAllocation`**

Add `product_id: parsed.data.product_id,` after `project_id: parsed.data.project_id,` in the `.update({...})` call:

```ts
    .update({
      user_id: parsed.data.user_id,
      project_id: parsed.data.project_id,
      product_id: parsed.data.product_id,
      role_on_project: parsed.data.role_on_project,
```

- [ ] **Step 6: Scope `createBulkAllocations`**

Add `.eq("product_id", parsed.data.product_id)` to its existing-allocations query, and pass `productId` into its `scheduleWeeklyAllocations` call (inside the `for (const userId of parsed.data.user_ids)` loop):

```ts
  const { data: existingAllocations, error: existingError } = await admin
    .from("allocations")
    .select("days_per_week, start_date, end_date")
    .eq("project_id", parsed.data.project_id)
    .eq("product_id", parsed.data.product_id)
    .eq("approval_status", "approved");
```

```ts
      const result = await scheduleWeeklyAllocations({
        admin,
        userId,
        projectId: parsed.data.project_id,
        productId: parsed.data.product_id,
        roleOnProject: parsed.data.role_on_project,
        priority: "medium",
        totalDays: remainingDays,
        startDateISO: project.start_date,
        projectEndDateISO: project.end_date,
        isLead,
        proposedBy: isLead ? null : profile.id,
      });
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from `allocation-action.ts` itself (errors in `allocation-form.tsx`/`bulk-assign-dialog.tsx`/`rebaseline-dialog.tsx` calling these functions are expected until Tasks 14–15).

- [ ] **Step 8: Commit**

```bash
git add src/features/allocation-action.ts
git commit -m "feat: scope remaining/committed day calculations to (project, product)"
```

---

### Task 8: `dashboard-action.ts`

**Files:**
- Modify: `src/features/dashboard-action.ts`

**Interfaces:**
- Consumes: `Project` (Task 2).
- Produces: `demandByProduct` groups by each allocation's own `product_id`; `getInProgressProjectsForUser`/`getProjectsForMonth` return `product_ids`-populated rows; `getProjectsByIds` is removed (dead after this change).

- [ ] **Step 1: Widen `getApprovedAllocationsInRange`'s selected columns**

Replace:

```ts
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
```

with:

```ts
async function getApprovedAllocationsInRange(
  start: string,
  end: string,
): Promise<(AllocationForCalc & { product_id: string })[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("allocations")
    .select("user_id, project_id, product_id, days_per_week, start_date, end_date")
    .eq("approval_status", "approved")
    .lte("start_date", end)
    .or(`end_date.is.null,end_date.gte.${start}`);
  if (error) throw new Error(error.message);
  return (data ?? []) as (AllocationForCalc & { product_id: string })[];
}
```

- [ ] **Step 2: Delete `getProjectsByIds`**

Remove this function entirely (it becomes dead once Step 3 stops calling it):

```ts
async function getProjectsByIds(ids: string[]): Promise<Project[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").select("*").in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as Project[];
}
```

- [ ] **Step 3: Simplify `demandByProduct` in `getWeeklyDashboard`**

Replace:

```ts
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
```

with:

```ts
  const daysByProductId = new Map<string, number>();
  for (const allocation of allocations) {
    daysByProductId.set(
      allocation.product_id,
      (daysByProductId.get(allocation.product_id) ?? 0) + allocation.days_per_week,
    );
  }
  const demandByProduct = [...daysByProductId.entries()]
    .map(([productId, days]) => ({ productId, days }))
    .sort((a, b) => b.days - a.days);
```

- [ ] **Step 4: Apply the same simplification in `getRangeDashboard`**

`getRangeDashboard` builds `demandByProduct` differently (via `rangeDaysForProject` per project, divided by `weeks`). Replace it with a per-allocation version that attributes each allocation's own prorated day contribution directly to its own `product_id`, instead of lumping a whole project's days under one product:

```ts
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
```

with:

```ts
  const daysByProductId = new Map<string, number>();
  for (const allocation of allocations) {
    const days = rangeDaysForUser([allocation], allocation.user_id, range) / weeks;
    daysByProductId.set(allocation.product_id, (daysByProductId.get(allocation.product_id) ?? 0) + days);
  }
  const demandByProduct = [...daysByProductId.entries()]
    .map(([productId, days]) => ({ productId, days }))
    .sort((a, b) => b.days - a.days);
```

(`rangeDaysForUser` is this file's existing import alias for `monthlyDaysForUser` from `@/lib/load` — passing a single-element array scoped to one allocation's own `user_id` correctly isolates just that allocation's prorated contribution to `range`.)

- [ ] **Step 5: Add the `project_products` join to `getInProgressProjectsForUser`**

Replace:

```ts
  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("*")
    .in("id", projectIds)
    .neq("status", "completed");
  if (projectsError) throw new Error(projectsError.message);
  return (projects ?? []) as Project[];
```

with:

```ts
  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("*, project_products(product_id)")
    .in("id", projectIds)
    .neq("status", "completed");
  if (projectsError) throw new Error(projectsError.message);
  return (projects ?? []).map((row) => {
    const { project_products, ...project } = row as Project & { project_products: { product_id: string }[] };
    return { ...project, product_ids: project_products.map((pp) => pp.product_id) };
  });
```

- [ ] **Step 6: Add the `project_products` join to `getProjectsForMonth`**

Replace:

```ts
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("approval_status", "approved")
    .lte("start_date", month.end)
    .or(`end_date.is.null,end_date.gte.${month.start}`);
  if (error) throw new Error(error.message);
  return (data ?? []) as Project[];
```

with:

```ts
  const { data, error } = await supabase
    .from("projects")
    .select("*, project_products(product_id)")
    .eq("approval_status", "approved")
    .lte("start_date", month.end)
    .or(`end_date.is.null,end_date.gte.${month.start}`);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const { project_products, ...project } = row as Project & { project_products: { product_id: string }[] };
    return { ...project, product_ids: project_products.map((pp) => pp.product_id) };
  });
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from `dashboard-action.ts` itself.

- [ ] **Step 8: Commit**

```bash
git add src/features/dashboard-action.ts
git commit -m "feat: derive dashboard product demand from allocation.product_id directly"
```

---

### Task 9: `ProductMultiSelect` component

**Files:**
- Create: `src/components/products/product-multi-select.tsx`

**Interfaces:**
- Consumes: `ProductRow` from `@/lib/product`; `Command`/`Popover`/`Button` building blocks (same as `QaMonthFilter`).
- Produces: `ProductMultiSelect` with props `{ products: ProductRow[]; selectedProductIds: string[]; onChange: (ids: string[]) => void }`. Consumed by Tasks 10 and 11.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ProductRow } from "@/lib/product";

type ProductMultiSelectProps = {
  products: ProductRow[];
  selectedProductIds: string[];
  onChange: (ids: string[]) => void;
};

export function ProductMultiSelect({ products, selectedProductIds, onChange }: ProductMultiSelectProps) {
  const [open, setOpen] = useState(false);

  function toggle(id: string) {
    onChange(
      selectedProductIds.includes(id)
        ? selectedProductIds.filter((existingId) => existingId !== id)
        : [...selectedProductIds, id],
    );
  }

  const selectedNames = products
    .filter((product) => selectedProductIds.includes(product.id))
    .map((product) => product.name);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", selectedNames.length === 0 && "text-muted-foreground")}>
            {selectedNames.length === 0 ? "Select products..." : selectedNames.join(", ")}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Search products..." />
          <CommandList>
            <CommandEmpty>No products found.</CommandEmpty>
            <CommandGroup>
              {products.map((product) => (
                <CommandItem key={product.id} value={product.name} onSelect={() => toggle(product.id)}>
                  <Check
                    className={cn("size-4", selectedProductIds.includes(product.id) ? "opacity-100" : "opacity-0")}
                  />
                  {product.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from this new file.

- [ ] **Step 3: Commit**

```bash
git add src/components/products/product-multi-select.tsx
git commit -m "feat: add ProductMultiSelect component"
```

---

### Task 10: `project-form-dialog.tsx`

**Files:**
- Modify: `src/components/projects/project-form-dialog.tsx`

**Interfaces:**
- Consumes: `ProductMultiSelect` (Task 9), `createProject`/`updateProject` (Task 4, now expect `product_ids`).

- [ ] **Step 1: Update `FormState` and `formFromProject`**

Replace:

```ts
type FormState = {
  name: string;
  item_type: ItemType;
  start_date: string;
  end_date: string;
  product_id: string;
  status: ProjectStatus;
  progress_percent: string;
  total_working_days: string;
  priority: Priority;
  jira_link: string;
  jiva_link: string;
};

function formFromProject(project?: Project): FormState {
  return project
    ? {
        name: project.name,
        item_type: project.item_type,
        start_date: project.start_date,
        end_date: project.end_date ?? "",
        product_id: project.product_id,
        status: project.status,
        progress_percent: String(project.progress_percent),
        total_working_days: String(project.total_working_days),
        priority: project.priority,
        jira_link: project.jira_link,
        jiva_link: project.jiva_link,
      }
    : {
        name: "",
        item_type: "project",
        start_date: "",
        end_date: "",
        product_id: "",
        status: "to_do",
        progress_percent: "0",
        total_working_days: "",
        priority: "medium",
        jira_link: "https://jpnqa.atlassian.net/jira",
        jiva_link: "https://jiva.jalin.co.id/",
      };
}
```

with:

```ts
type FormState = {
  name: string;
  item_type: ItemType;
  start_date: string;
  end_date: string;
  product_ids: string[];
  status: ProjectStatus;
  progress_percent: string;
  total_working_days: string;
  priority: Priority;
  jira_link: string;
  jiva_link: string;
};

function formFromProject(project?: Project): FormState {
  return project
    ? {
        name: project.name,
        item_type: project.item_type,
        start_date: project.start_date,
        end_date: project.end_date ?? "",
        product_ids: project.product_ids,
        status: project.status,
        progress_percent: String(project.progress_percent),
        total_working_days: String(project.total_working_days),
        priority: project.priority,
        jira_link: project.jira_link,
        jiva_link: project.jiva_link,
      }
    : {
        name: "",
        item_type: "project",
        start_date: "",
        end_date: "",
        product_ids: [],
        status: "to_do",
        progress_percent: "0",
        total_working_days: "",
        priority: "medium",
        jira_link: "https://jpnqa.atlassian.net/jira",
        jiva_link: "https://jiva.jalin.co.id/",
      };
}
```

- [ ] **Step 2: Update the mutation payload**

Replace `product_id: form.product_id,` with `product_ids: form.product_ids,` in the `payload` object inside `mutation`.

- [ ] **Step 3: Add the `ProductMultiSelect` import**

```ts
import { ProductMultiSelect } from "@/components/products/product-multi-select";
```

- [ ] **Step 4: Replace the Product `<Select>` field**

Replace:

```tsx
            <div className="space-y-2">
              <Label htmlFor="product">Product</Label>
              <Select value={form.product_id} onValueChange={(value) => setForm((f) => ({ ...f, product_id: value }))}>
                <SelectTrigger id="product" className="w-full">
                  <SelectValue placeholder="Select a product..." />
                </SelectTrigger>
                <SelectContent>
                  {(products ?? []).map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
```

with:

```tsx
            <div className="space-y-2">
              <Label htmlFor="product">Products</Label>
              <ProductMultiSelect
                products={products ?? []}
                selectedProductIds={form.product_ids}
                onChange={(ids) => setForm((f) => ({ ...f, product_ids: ids }))}
              />
            </div>
```

- [ ] **Step 5: Update the submit-disabled condition**

Replace `disabled={mutation.isPending || !form.product_id}` with `disabled={mutation.isPending || form.product_ids.length === 0}`.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from this file.

- [ ] **Step 7: Commit**

```bash
git add src/components/projects/project-form-dialog.tsx
git commit -m "feat: multi-select products in the project create/edit form"
```

---

### Task 11: `propose-project-dialog.tsx`

**Files:**
- Modify: `src/components/projects/propose-project-dialog.tsx`

**Interfaces:**
- Consumes: `ProductMultiSelect` (Task 9), `proposeProject` (Task 4, expects `product_ids` and per-allocation `product_id`).

- [ ] **Step 1: Replace `productId` state with `productIds`, and thread it into `emptyAllocationRow`**

Replace:

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

with:

```ts
type AllocationRow = {
  user_id: string;
  product_id: string;
  role_on_project: string;
  days_per_week: string;
  start_date: string;
  end_date: string;
};

function emptyAllocationRow(productIds: string[]): AllocationRow {
  return {
    user_id: "",
    product_id: productIds.length === 1 ? productIds[0] : "",
    role_on_project: "",
    days_per_week: "1",
    start_date: "",
    end_date: "",
  };
}
```

Replace `const [productId, setProductId] = useState("");` with `const [productIds, setProductIds] = useState<string[]>([]);`.

Replace `const [rows, setRows] = useState<AllocationRow[]>([emptyAllocationRow()]);` with
`const [rows, setRows] = useState<AllocationRow[]>([emptyAllocationRow([])]);`.

- [ ] **Step 2: Update the mutation payload**

Replace:

```ts
        project: {
          name,
          item_type: itemType,
          start_date: startDate,
          end_date: endDate,
          product_id: productId,
          status,
          progress_percent: 0,
          priority,
          jira_link: jiraLink,
          jiva_link: jivaLink,
        },
        allocations: rows.map((row) => ({
          user_id: row.user_id,
          role_on_project: row.role_on_project,
          days_per_week: Number(row.days_per_week),
          start_date: row.start_date,
          end_date: row.end_date || undefined,
        })),
```

with:

```ts
        project: {
          name,
          item_type: itemType,
          start_date: startDate,
          end_date: endDate,
          product_ids: productIds,
          status,
          progress_percent: 0,
          priority,
          jira_link: jiraLink,
          jiva_link: jivaLink,
        },
        allocations: rows.map((row) => ({
          user_id: row.user_id,
          product_id: row.product_id,
          role_on_project: row.role_on_project,
          days_per_week: Number(row.days_per_week),
          start_date: row.start_date,
          end_date: row.end_date || undefined,
        })),
```

- [ ] **Step 3: Reset `productIds` and rows on success**

In `onSuccess`, add `setProductIds([]);` alongside the other resets, and change `setRows([emptyAllocationRow()]);` to `setRows([emptyAllocationRow([])]);`.

- [ ] **Step 4: Add the `ProductMultiSelect` import**

```ts
import { ProductMultiSelect } from "@/components/products/product-multi-select";
```

- [ ] **Step 5: Replace the Product `<Select>` field**

Replace:

```tsx
            <div className="space-y-2">
              <Label htmlFor="proposal_product">Product</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger id="proposal_product" className="w-full">
                  <SelectValue placeholder="Select a product..." />
                </SelectTrigger>
                <SelectContent>
                  {(products ?? []).map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
```

with:

```tsx
            <div className="space-y-2">
              <Label htmlFor="proposal_product">Products</Label>
              <ProductMultiSelect products={products ?? []} selectedProductIds={productIds} onChange={setProductIds} />
            </div>
```

- [ ] **Step 6: Add a per-row Product select, scoped to `productIds`**

In the "Tester Assignments" row layout, change the grid from `grid-cols-12` to `grid-cols-14` to fit one more column, shrink the Tester/Role columns by one each, and insert a Product select. Replace:

```tsx
            {rows.map((row, index) => (
              <div key={index} className="grid grid-cols-12 items-end gap-2 rounded-md border p-3">
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs">Tester</Label>
                  <Select value={row.user_id} onValueChange={(value) => updateRow(index, { user_id: value })}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(testers ?? []).map((tester) => (
                        <SelectItem key={tester.id} value={tester.id}>
                          {tester.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs">Role</Label>
                  <Input value={row.role_on_project} onChange={(e) => updateRow(index, { role_on_project: e.target.value })} required />
                </div>
```

with:

```tsx
            {rows.map((row, index) => (
              <div key={index} className="grid grid-cols-14 items-end gap-2 rounded-md border p-3">
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Tester</Label>
                  <Select value={row.user_id} onValueChange={(value) => updateRow(index, { user_id: value })}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(testers ?? []).map((tester) => (
                        <SelectItem key={tester.id} value={tester.id}>
                          {tester.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Product</Label>
                  <Select
                    value={row.product_id}
                    onValueChange={(value) => updateRow(index, { product_id: value })}
                    disabled={productIds.length === 0}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(products ?? [])
                        .filter((product) => productIds.includes(product.id))
                        .map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Role</Label>
                  <Input value={row.role_on_project} onChange={(e) => updateRow(index, { role_on_project: e.target.value })} required />
                </div>
```

And update the remaining cells' `col-span-*` in that same row (Days/Wk, Start, End, remove-button) from `col-span-2 col-span-2 col-span-1 col-span-1` to `col-span-2 col-span-2 col-span-2 col-span-2` so the row's columns sum to 14 (2 Tester + 2 Product + 2 Role + 2 Days/Wk + 2 Start + 2 End + 2 remove-button = 14).

- [ ] **Step 7: Update the "Add tester" button and submit-disabled condition**

Replace `onClick={() => setRows((r) => [...r, emptyAllocationRow()])}` with `onClick={() => setRows((r) => [...r, emptyAllocationRow(productIds)])}`.

Replace `disabled={mutation.isPending || !productId}` with `disabled={mutation.isPending || productIds.length === 0}`.

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from this file.

- [ ] **Step 9: Commit**

```bash
git add src/components/projects/propose-project-dialog.tsx
git commit -m "feat: multi-select products and per-row product in the propose-project form"
```

---

### Task 12: Project list, summary chart, and sort

**Files:**
- Modify: `src/components/projects/project-table.tsx`
- Modify: `src/components/projects/project-summary-cards.tsx`
- Modify: `src/components/projects/projects-page-content.tsx`

**Interfaces:**
- Consumes: `Project.product_ids` (Task 2).

- [ ] **Step 1: `project-table.tsx` — multiple product badges**

Replace:

```tsx
                  <TableCell>
                    <Badge variant="secondary">{productNameById.get(project.product_id) ?? "—"}</Badge>
                  </TableCell>
```

with:

```tsx
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {project.product_ids.map((productId) => (
                        <Badge key={productId} variant="secondary">
                          {productNameById.get(productId) ?? "—"}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
```

Also pass `productNameById` down to `ProjectAssignmentsDialog` (needed by Task 13):

```tsx
      {viewingProject && (
        <ProjectAssignmentsDialog
          key={viewingProject.id}
          project={viewingProject}
          productNameById={productNameById}
          open
```

- [ ] **Step 2: `project-summary-cards.tsx` — count per product, not per project**

Replace:

```ts
  const productCounts = new Map<string, number>();
  for (const project of rows) {
    productCounts.set(project.product_id, (productCounts.get(project.product_id) ?? 0) + 1);
  }
```

with:

```ts
  const productCounts = new Map<string, number>();
  for (const project of rows) {
    for (const productId of project.product_ids) {
      productCounts.set(productId, (productCounts.get(productId) ?? 0) + 1);
    }
  }
```

- [ ] **Step 3: `projects-page-content.tsx` — sort by joined product names**

Replace:

```ts
      case "product":
        return (
          (productNameById.get(a.product_id) ?? "").localeCompare(productNameById.get(b.product_id) ?? "") *
          direction
        );
```

with:

```ts
      case "product": {
        const namesA = a.product_ids.map((id) => productNameById.get(id) ?? "").sort().join(", ");
        const namesB = b.product_ids.map((id) => productNameById.get(id) ?? "").sort().join(", ");
        return namesA.localeCompare(namesB) * direction;
      }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: errors remaining only in `project-assignments-dialog.tsx` (fixed next task).

- [ ] **Step 5: Commit**

```bash
git add src/components/projects/project-table.tsx src/components/projects/project-summary-cards.tsx src/components/projects/projects-page-content.tsx
git commit -m "feat: render/count/sort projects by their full product list"
```

---

### Task 13: `project-assignments-dialog.tsx`

**Files:**
- Modify: `src/components/projects/project-assignments-dialog.tsx`

**Interfaces:**
- Consumes: `productNameById` prop, passed in by Task 12's `project-table.tsx` change.

- [ ] **Step 1: Add the `productNameById` prop**

```ts
type ProjectAssignmentsDialogProps = {
  project: Project;
  productNameById: Map<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProjectAssignmentsDialog({ project, productNameById, open, onOpenChange }: ProjectAssignmentsDialogProps) {
```

- [ ] **Step 2: Add a Product column**

Replace:

```tsx
            <TableRow>
              <TableHead>QA</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Days/Wk</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Timeline</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
```

with:

```tsx
            <TableRow>
              <TableHead>QA</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Days/Wk</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Timeline</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
```

Update both `colSpan={6}` occurrences (loading and empty states) to `colSpan={7}`.

Replace:

```tsx
                  <TableCell className="text-sm font-medium">
                    {profileNameById.get(allocation.user_id) ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{allocation.role_on_project}</TableCell>
```

with:

```tsx
                  <TableCell className="text-sm font-medium">
                    {profileNameById.get(allocation.user_id) ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {productNameById.get(allocation.product_id) ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{allocation.role_on_project}</TableCell>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from `project-assignments-dialog.tsx` or `project-table.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/components/projects/project-assignments-dialog.tsx
git commit -m "feat: show which product each assignment is for in Assigned QAs"
```

---

### Task 14: `allocation-form.tsx` and the rebaseline product passthrough

**Files:**
- Modify: `src/components/allocations/allocation-form.tsx`
- Modify: `src/components/allocations/rebaseline-dialog.tsx`

**Interfaces:**
- Consumes: `getRemainingProjectDays(projectId, productId)`, `getAssignedQaNames(projectId, productId)` (Task 7); `getProducts` (existing action).

- [ ] **Step 1: Add product state and a products query**

Add to the imports:

```ts
import { getProducts } from "@/features/product-action";
```

Add state and a query, alongside the existing `projectId`/`projectPopoverOpen` state:

```ts
  const [productId, setProductId] = useState("");

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });
```

- [ ] **Step 2: Auto-select the product when a project has exactly one**

Update `handleProjectChange` to also reset/auto-select `productId`:

```ts
  function handleProjectChange(value: string) {
    setProjectId(value);
    const project = projects.find((p) => p.id === value);
    setStartDate(project?.start_date ?? "");
    setProductId(project && project.product_ids.length === 1 ? project.product_ids[0] : "");
  }
```

- [ ] **Step 3: Scope the remaining-days and assigned-QA queries**

Replace:

```ts
  const { data: remainingDays } = useQuery({
    queryKey: ["remaining-project-days", projectId],
    queryFn: () => getRemainingProjectDays(projectId),
    enabled: projectId !== "",
  });

  const { data: assignedQaNames } = useQuery({
    queryKey: ["assigned-qa-names", projectId],
    queryFn: () => getAssignedQaNames(projectId),
    enabled: projectId !== "",
  });
```

with:

```ts
  const { data: remainingDays } = useQuery({
    queryKey: ["remaining-project-days", projectId, productId],
    queryFn: () => getRemainingProjectDays(projectId, productId),
    enabled: projectId !== "" && productId !== "",
  });

  const { data: assignedQaNames } = useQuery({
    queryKey: ["assigned-qa-names", projectId, productId],
    queryFn: () => getAssignedQaNames(projectId, productId),
    enabled: projectId !== "" && productId !== "",
  });
```

- [ ] **Step 4: Add `product_id` to the mutation payload, invalidations, and reset**

Replace:

```ts
      createAllocation({
        user_id: userId,
        project_id: projectId,
        role_on_project: roleOnProject,
        start_date: startDate,
        priority,
      }),
```

with:

```ts
      createAllocation({
        user_id: userId,
        project_id: projectId,
        product_id: productId,
        role_on_project: roleOnProject,
        start_date: startDate,
        priority,
      }),
```

Replace:

```ts
      queryClient.invalidateQueries({ queryKey: ["remaining-project-days", projectId] });
      queryClient.invalidateQueries({ queryKey: ["assigned-qa-names", projectId] });
      setProjectId("");
      setRoleOnProject("");
      setStartDate("");
      setPriority("medium");
```

with:

```ts
      queryClient.invalidateQueries({ queryKey: ["remaining-project-days", projectId, productId] });
      queryClient.invalidateQueries({ queryKey: ["assigned-qa-names", projectId, productId] });
      setProjectId("");
      setProductId("");
      setRoleOnProject("");
      setStartDate("");
      setPriority("medium");
```

- [ ] **Step 5: Add the Product select, and require it in `canSubmit`**

Replace `const canSubmit = projectId !== "" && roleOnProject.trim() !== "" && startDate !== "";` with:

```ts
  const canSubmit = projectId !== "" && productId !== "" && roleOnProject.trim() !== "" && startDate !== "";
```

Insert a Product field right after the existing "Target Project" block's closing `</div>` (after the `{selectedProject && (...)}` block), shown only when the selected project has more than one product:

```tsx
      {selectedProject && selectedProject.product_ids.length > 1 && (
        <div className="space-y-2">
          <Label htmlFor="product">Product</Label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger id="product" className="w-full">
              <SelectValue placeholder="Select a product..." />
            </SelectTrigger>
            <SelectContent>
              {(products ?? [])
                .filter((product) => selectedProject.product_ids.includes(product.id))
                .map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}
```

- [ ] **Step 6: Fix `rebaseline-dialog.tsx`'s `updateAllocation` call**

`AllocationInput` (Task 3) now requires `product_id`. `RebaselineDialog` never lets the user change it, but must still pass the allocation's existing value through. Replace:

```ts
        ? updateAllocation(allocation.id, {
            user_id: allocation.user_id,
            project_id: allocation.project_id,
            role_on_project: allocation.role_on_project,
            days_per_week: Number(daysPerWeek),
```

with:

```ts
        ? updateAllocation(allocation.id, {
            user_id: allocation.user_id,
            project_id: allocation.project_id,
            product_id: allocation.product_id,
            role_on_project: allocation.role_on_project,
            days_per_week: Number(daysPerWeek),
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from either file.

- [ ] **Step 8: Commit**

```bash
git add src/components/allocations/allocation-form.tsx src/components/allocations/rebaseline-dialog.tsx
git commit -m "feat: scope single-QA assignment to a product; pass product_id through rebaseline"
```

---

### Task 15: `bulk-assign-dialog.tsx`

**Files:**
- Modify: `src/components/allocations/bulk-assign-dialog.tsx`

**Interfaces:**
- Consumes: `getRemainingProjectDays(projectId, productId)` (Task 7), `createBulkAllocations` (Task 7, now expects `product_id`).

- [ ] **Step 1: Add product state and a products query**

Add to the imports:

```ts
import { getProducts } from "@/features/product-action";
```

Add state and a query near the top of the component:

```ts
  const [productId, setProductId] = useState(
    presetProject && presetProject.product_ids.length === 1 ? presetProject.product_ids[0] : "",
  );

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });
```

- [ ] **Step 2: Auto-select on manual project pick too**

The non-preset path uses a plain `<Select value={projectId} onValueChange={setProjectId}>`. Replace it with a handler that also sets `productId`:

```tsx
              <Select
                value={projectId}
                onValueChange={(value) => {
                  setProjectId(value);
                  const project = (projects ?? []).find((p) => p.id === value);
                  setProductId(project && project.product_ids.length === 1 ? project.product_ids[0] : "");
                }}
              >
```

- [ ] **Step 3: Scope the remaining-days query**

Replace:

```ts
  const { data: remainingDays } = useQuery({
    queryKey: ["remaining-project-days", projectId],
    queryFn: () => getRemainingProjectDays(projectId),
    enabled: projectId !== "",
  });
```

with:

```ts
  const { data: remainingDays } = useQuery({
    queryKey: ["remaining-project-days", projectId, productId],
    queryFn: () => getRemainingProjectDays(projectId, productId),
    enabled: projectId !== "" && productId !== "",
  });
```

- [ ] **Step 4: Add `product_id` to the mutation payload, invalidation, and reset**

Replace:

```ts
      createBulkAllocations({
        project_id: projectId,
        user_ids: selectedUserIds,
        role_on_project: roleOnProject,
      }),
```

with:

```ts
      createBulkAllocations({
        project_id: projectId,
        product_id: productId,
        user_ids: selectedUserIds,
        role_on_project: roleOnProject,
      }),
```

Replace `queryClient.invalidateQueries({ queryKey: ["remaining-project-days", projectId] });` with
`queryClient.invalidateQueries({ queryKey: ["remaining-project-days", projectId, productId] });`.

Replace `setProjectId(presetProject?.id ?? "");` with:

```ts
      setProjectId(presetProject?.id ?? "");
      setProductId(presetProject && presetProject.product_ids.length === 1 ? presetProject.product_ids[0] : "");
```

- [ ] **Step 5: Add the Product select and require it to submit**

Insert after the existing "Project / Activity" block's closing `</div>`, shown when the effective selected project (`presetProject ?? (projects ?? []).find((p) => p.id === projectId)`) has more than one product — first add that lookup near `selectedProject`:

```ts
  const selectedProject = presetProject ?? (projects ?? []).find((p) => p.id === projectId) ?? null;
```

(this already exists in the file — no change needed here, just confirming it's in scope for the new block below)

```tsx
          {selectedProject && selectedProject.product_ids.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="bulk_product">Product</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger id="bulk_product" className="w-full">
                  <SelectValue placeholder="Select a product..." />
                </SelectTrigger>
                <SelectContent>
                  {(products ?? [])
                    .filter((product) => selectedProject.product_ids.includes(product.id))
                    .map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
```

Replace `disabled={!projectId || selectedUserIds.length === 0 || mutation.isPending}` with:

```tsx
            <Button type="submit" disabled={!projectId || !productId || selectedUserIds.length === 0 || mutation.isPending}>
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no remaining errors anywhere in the project (this is the last file touched by the migration's cascading type changes).

- [ ] **Step 7: Commit**

```bash
git add src/components/allocations/bulk-assign-dialog.tsx
git commit -m "feat: scope bulk QA assignment to a product"
```

---

### Task 16: Approvals display

**Files:**
- Modify: `src/components/approvals/approvals-page-content.tsx`
- Modify: `src/components/approvals/project-proposal-card.tsx`

**Interfaces:**
- Consumes: `PendingProjectProposal.product_ids` (Task 5), `Allocation.product_id` (Task 2).

- [ ] **Step 1: Pass `productNameById` instead of a single `productName`**

In `approvals-page-content.tsx`, replace:

```tsx
                productName={productNameById.get(proposal.product_id) ?? "—"}
```

with:

```tsx
                productNameById={productNameById}
```

- [ ] **Step 2: Update `ProjectProposalCard`'s props**

In `project-proposal-card.tsx`, replace:

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
```

with:

```ts
type ProjectProposalCardProps = {
  proposal: PendingProjectProposal;
  productNameById: Map<string, string>;
  onApprove: (totalWorkingDays: number) => void;
  onReject: () => void;
  approving: boolean;
  rejecting: boolean;
};

export function ProjectProposalCard({
  proposal,
  productNameById,
  onApprove,
  onReject,
  approving,
  rejecting,
}: ProjectProposalCardProps) {
```

- [ ] **Step 3: Render one badge per product**

Replace:

```tsx
            <span className="font-medium">{proposal.name}</span>
            <Badge variant="secondary">{productName}</Badge>
```

with:

```tsx
            <span className="font-medium">{proposal.name}</span>
            {proposal.product_ids.map((productId) => (
              <Badge key={productId} variant="secondary">
                {productNameById.get(productId) ?? "—"}
              </Badge>
            ))}
```

- [ ] **Step 4: Add a Product column to the proposed-assignments mini table**

Replace:

```tsx
        <TableHeader>
          <TableRow>
            <TableHead>Role</TableHead>
            <TableHead className="text-right">Days/Wk</TableHead>
            <TableHead>Timeline</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {proposal.allocations.map((allocation) => (
            <TableRow key={allocation.id}>
              <TableCell>{allocation.role_on_project}</TableCell>
              <TableCell className="text-right tabular-nums">{allocation.days_per_week}</TableCell>
              <TableCell>
                {formatDate(allocation.start_date)} –{" "}
                {allocation.end_date ? formatDate(allocation.end_date) : "Ongoing"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
```

with:

```tsx
        <TableHeader>
          <TableRow>
            <TableHead>Role</TableHead>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Days/Wk</TableHead>
            <TableHead>Timeline</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {proposal.allocations.map((allocation) => (
            <TableRow key={allocation.id}>
              <TableCell>{allocation.role_on_project}</TableCell>
              <TableCell>{productNameById.get(allocation.product_id) ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{allocation.days_per_week}</TableCell>
              <TableCell>
                {formatDate(allocation.start_date)} –{" "}
                {allocation.end_date ? formatDate(allocation.end_date) : "Ongoing"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: **zero errors anywhere in the project.** This is the final file in the type-error cascade started by Task 2 — if anything still fails, find and fix the remaining call site before moving on (do not proceed to Task 17 with a red build).

- [ ] **Step 6: Commit**

```bash
git add src/components/approvals/approvals-page-content.tsx src/components/approvals/project-proposal-card.tsx
git commit -m "feat: show all of a proposal's products and per-assignment product in Approvals"
```

---

### Task 17: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Manual QA pass**

Run the dev server (`npm run dev`), sign in as a QA Lead, and on Project Portfolio / Allocation Tool / Approvals / Settings:

1. **Single-product project (regression check)**: create a project with exactly one product. Confirm the form behaves exactly as before. Assign a QA via the Allocation Tool — confirm no Product field appears (auto-selected) and "Remaining days" shows `total_working_days` minus committed, same as pre-change behavior.
2. **Multi-product project**: create a project with 2–3 products. Confirm the table's Products column shows all of them as separate badges, and the By Product chart on this page counts the project once per product.
3. **Per-product remaining days**: assign a QA to Product A on that project — confirm "Remaining days" for Product A drops, while Product B's remaining days (checked by re-opening the assignment form and picking Product B) is still the full `total_working_days`, unaffected.
4. **Assigned QAs dialog**: open "N QAs" on the multi-product project's row — confirm each row shows the correct Product.
5. **Removing an in-use product**: try editing the project to drop a product that still has an approved assignment — confirm it's blocked with a clear error naming the product and assignment count. Remove the assignment first, then confirm the product can now be removed.
6. **Product filter**: filter Project Portfolio by one of the multi-product project's products — confirm the project still shows up.
7. **Propose flow (as a Project Manager)**: propose a new project with 2 products and one tester assignment per product — confirm both go to Approvals, and the proposal card shows both product badges plus a Product column per proposed assignment. Approve it — confirm it appears correctly in Project Portfolio afterward.
8. **Product Demand chart**: on the Dashboard, confirm the "Product Demand" pie chart reflects days per product correctly for a multi-product project's assignments (each product's slice should reflect only its own assigned days, not the whole project's).
9. **Deleting a product still in use anywhere**: confirm Settings still blocks deleting a product referenced by any project.

- [ ] **Step 3: Report results**

If every check in Step 2 passes, this feature is complete. If anything fails, stop and report exactly which check failed and what was observed — do not attempt a fix without diagnosing the root cause first (see `superpowers:systematic-debugging`).
