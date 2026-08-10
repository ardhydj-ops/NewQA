# QA Resource Manager v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the v3 changes from `docs/superpowers/specs/2026-08-10-qa-resource-manager-v3-design.md` on top of the shipped v1+v2 app: a project-assigned-QAs view, a date-range planning period on the Allocation Tool, CRUD-managed QA Groups and Products (replacing hardcoded enums), QA-Group-grouped resource picking, and a QA-count column on the dashboard's group breakdown.

**Architecture:** Same conventions as v1/v2 — `"use server"` action files per feature, Zod validation, TanStack React Query on the client, shadcn/ui, sonner toasts, service-role client for all writes. Most tasks replace the full content of an existing file; a few are net-new files. QA Groups and Products are structurally identical (id + name lookup tables with the same CRUD shape), so their Settings UI shares one generic `NameEntityCard` component instead of being duplicated.

**Tech Stack:** Unchanged (Next.js 16.2.6, React 19.2.4, Supabase, TanStack Query 5, Zod 4, shadcn/ui, Tailwind 4).

## Global Constraints

- All INSERT/UPDATE/DELETE still go through `createAdminClient()`; all SELECT reads still go through the cookie-scoped `createClient()`. No change to this v1 rule.
- `QaGroup` and `Product` TypeScript union types are deleted entirely — `profiles.qa_group_id` and `projects.product_id` are plain `string`/`string | null` UUID references from here on. Every consumer of the old hardcoded `Record<QaGroup, string>` / `Record<Product, string>` label maps is updated in this plan; do not reintroduce a hardcoded label map anywhere.
- QA Group is optional on a profile (`qa_group_id: string | null`, "None" selectable); Product is required on a project (`product_id: string`, no "None" option) — same optionality as the old enum fields had.
- Deleting a QA Group or Product is blocked with a friendly count-based error if anything still references it (`"Can't delete: N QA(s) are still in this group"` / `"Can't delete: N project(s) use this product"`). No cascade, no orphaning.
- The Allocation Tool's date-range "average hrs/week" figures reuse the existing day-prorated overlap math (`monthlyHoursForUser`/`monthlyHoursForProject` in `src/lib/load.ts`, which are already range-generic despite their name) divided by `weeksBetween(start, end)` — no new pure-math functions are needed, just renamed imports at the call site for clarity.
- Verification per task: `npx tsc --noEmit`, `npx eslint <changed files>`. No automated test framework, same as v1/v2. Manual smoke checks use the browser via `mcp__claude-in-chrome__*` tools against `npm run dev` when credentials are available; otherwise note it as a manual follow-up, consistent with how v2's final verification was handled.
- Migrations are applied manually via the Supabase Dashboard SQL Editor, same as v1/v2. The v3 migration performs a one-time destructive cutover (drops `profiles.qa_group` and `projects.product` after backfilling their replacements) — it is not safely re-runnable once it succeeds.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/0003_qa_resource_manager_v3.sql`

**Interfaces:**
- Consumes: `public.set_updated_at()` (already defined by v1's `0001_qa_resource_manager.sql`).
- Produces: tables `public.qa_groups` and `public.products` (both `{ id uuid, name text unique, created_at, updated_at }`), seeded with today's five QA Group / six Product labels; new columns `public.profiles.qa_group_id` (nullable FK) and `public.projects.product_id` (required FK), backfilled from the old `qa_group`/`product` text columns and then those old columns dropped. Every later task's types/queries depend on these exact table/column names.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0003_qa_resource_manager_v3.sql`:

```sql
-- QA Resource Manager v3 — QA Group / Product become CRUD-managed lookup
-- tables (replacing the old hardcoded enums), project-QA visibility, and
-- date-range planning period support (no schema change needed for that part).
-- Run via Supabase Dashboard -> SQL Editor -> paste -> Run.
--
-- NOTE: this is a one-time destructive cutover (drops profiles.qa_group and
-- projects.product after backfilling their replacements). Do not re-run
-- after it succeeds.

create table if not exists public.qa_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);

create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);

drop trigger if exists qa_groups_set_updated_at on public.qa_groups;
create trigger qa_groups_set_updated_at
  before update on public.qa_groups
  for each row execute function public.set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

alter table public.qa_groups enable row level security;
alter table public.products enable row level security;

create policy "Authenticated read" on public.qa_groups
  for select using (auth.role() = 'authenticated');
create policy "Authenticated read" on public.products
  for select using (auth.role() = 'authenticated');

-- Seed with today's hardcoded labels, in their current display order.
insert into public.qa_groups (name) values
  ('QRIS H2H'), ('QRIS BO'), ('Digital H2H'), ('Digital BO'), ('Corporate IT')
on conflict (name) do nothing;

insert into public.products (name) values
  ('QRIS H2H'), ('QRIS BO'), ('QRCB'), ('PI'), ('JV'), ('CCW')
on conflict (name) do nothing;

alter table public.profiles add column if not exists qa_group_id uuid references public.qa_groups(id);
alter table public.projects add column if not exists product_id uuid references public.products(id);

update public.profiles set qa_group_id = (
  select id from public.qa_groups where name = case profiles.qa_group
    when 'qris_h2h' then 'QRIS H2H'
    when 'qris_bo' then 'QRIS BO'
    when 'digital_h2h' then 'Digital H2H'
    when 'digital_bo' then 'Digital BO'
    when 'corporate_it' then 'Corporate IT'
  end
) where qa_group_id is null and qa_group is not null;

update public.projects set product_id = (
  select id from public.products where name = case projects.product
    when 'qris_h2h' then 'QRIS H2H'
    when 'qris_bo' then 'QRIS BO'
    when 'qrcb' then 'QRCB'
    when 'pi' then 'PI'
    when 'jv' then 'JV'
    when 'ccw' then 'CCW'
  end
) where product_id is null;

alter table public.projects alter column product_id set not null;

alter table public.profiles drop column qa_group;
alter table public.projects drop column product;

create index if not exists qa_groups_name_idx on public.qa_groups (name);
create index if not exists products_name_idx on public.products (name);
create index if not exists profiles_qa_group_id_idx on public.profiles (qa_group_id);
create index if not exists projects_product_id_idx on public.projects (product_id);
```

- [ ] **Step 2: Apply the migration**

Supabase Dashboard -> SQL Editor -> paste the full file contents -> Run.
Expected: no errors. Table Editor -> confirm `qa_groups` has 5 rows and `products` has 6 rows with the expected names; `profiles.qa_group_id` and `projects.product_id` are populated for existing rows (matching what `qa_group`/`product` used to say); `profiles.qa_group` and `projects.product` columns no longer exist.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0003_qa_resource_manager_v3.sql
git commit -m "feat: add v3 schema — qa_groups/products lookup tables, drop hardcoded enums"
```

---

### Task 2: Shared type updates

**Files:**
- Create: `src/lib/qa-group.ts`
- Create: `src/lib/product.ts`
- Modify: `src/lib/profile.ts`
- Modify: `src/lib/project.ts`

**Interfaces:**
- Consumes: nothing (pure types).
- Produces: `QaGroupRow = { id: string; name: string }` from `@/lib/qa-group`; `ProductRow = { id: string; name: string }` from `@/lib/product`; `Profile.qa_group_id: string | null` replaces `Profile.qa_group` (the `QaGroup` type is deleted); `Project.product_id: string` replaces `Project.product` (the `Product` type is deleted). Consumed by every task from Task 3 onward.

- [ ] **Step 1: Write `src/lib/qa-group.ts`**

```ts
export type QaGroupRow = {
  id: string;
  name: string;
};
```

- [ ] **Step 2: Write `src/lib/product.ts`**

```ts
export type ProductRow = {
  id: string;
  name: string;
};
```

- [ ] **Step 3: Update `src/lib/profile.ts`**

```ts
export type ProfileRole = "qa_lead" | "qa_member" | "project_manager";

export type Profile = {
  id: string;
  name: string;
  email: string;
  role: ProfileRole;
  qa_group_id: string | null;
  capacity_hours: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 4: Update `src/lib/project.ts`**

```ts
export type ProjectStatus =
  | "to_do"
  | "ready_sit"
  | "sit"
  | "ready_uat"
  | "uat"
  | "completed";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type ItemType = "project" | "support_testing" | "problem_incident" | "service_request";

export type Priority = "low" | "medium" | "high" | "critical";

export type Project = {
  id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  product_id: string;
  status: ProjectStatus;
  progress_percent: number;
  item_type: ItemType;
  total_working_hours: number;
  priority: Priority;
  approval_status: ApprovalStatus;
  proposed_by: string | null;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: errors in every file that still references the deleted `QaGroup`/`Product` types or the old `qa_group`/`product` fields — this is expected until later tasks update them. Confirm the error list only touches `src/features/profile-schema.ts`, `src/features/profile-action.ts`, `src/features/project-schema.ts`, `src/features/project-action.ts`, `src/features/dashboard-action.ts`, `src/features/allocation-action.ts` (dashboard/allocation only if they happen to reference `Product`/`QaGroup` — check), and the `src/components/team/*` / `src/components/projects/*` / `src/components/dashboard/*` / `src/components/allocations/*` files — no errors outside those.

- [ ] **Step 6: Commit**

```bash
git add src/lib/qa-group.ts src/lib/product.ts src/lib/profile.ts src/lib/project.ts
git commit -m "feat: replace QaGroup/Product enums with qa_group_id/product_id references"
```

---

### Task 3: Zod schema updates

**Files:**
- Create: `src/features/qa-group-schema.ts`
- Create: `src/features/product-schema.ts`
- Modify: `src/features/profile-schema.ts`
- Modify: `src/features/project-schema.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces: `QaGroupInput = { name: string }` from `@/features/qa-group-schema`; `ProductInput = { name: string }` from `@/features/product-schema`; `ProfileInput`/`ProfileUpdateInput` gain `qa_group_id: string (uuid) | undefined` (was `qa_group` enum); `ProjectInput` gains `product_id: string (uuid)` required (was `product` enum). Consumed starting Task 4 (QA Group/Product schemas) and Task 6–7 (the rest).

- [ ] **Step 1: Write `src/features/qa-group-schema.ts`**

```ts
import { z } from "zod";

export const QaGroupInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
});
export type QaGroupInput = z.infer<typeof QaGroupInput>;
```

- [ ] **Step 2: Write `src/features/product-schema.ts`**

```ts
import { z } from "zod";

export const ProductInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
});
export type ProductInput = z.infer<typeof ProductInput>;
```

- [ ] **Step 3: Update `src/features/profile-schema.ts`**

```ts
import { z } from "zod";

export const ProfileInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Enter a valid email"),
  role: z.enum(["qa_lead", "qa_member", "project_manager"]),
  qa_group_id: z.string().uuid().optional(),
  capacity_hours: z.number().positive("Capacity must be greater than 0"),
});
export type ProfileInput = z.infer<typeof ProfileInput>;

// Editing never changes email (would require syncing auth.users separately).
export const ProfileUpdateInput = ProfileInput.omit({ email: true });
export type ProfileUpdateInput = z.infer<typeof ProfileUpdateInput>;
```

- [ ] **Step 4: Update `src/features/project-schema.ts`**

```ts
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

export const ProjectInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  item_type: z.enum(["project", "support_testing", "problem_incident", "service_request"]),
  start_date: isoDate,
  end_date: isoDate,
  product_id: z.string().uuid("Select a product"),
  status: z.enum(["to_do", "ready_sit", "sit", "ready_uat", "uat", "completed"]),
  progress_percent: z.number().int().min(0).max(100),
  total_working_hours: z.number().positive("Total working hours must be greater than 0"),
  priority: z.enum(["low", "medium", "high", "critical"]),
});
export type ProjectInput = z.infer<typeof ProjectInput>;

export const ProposedAllocationInput = z.object({
  user_id: z.string().uuid("Select a tester"),
  role_on_project: z.string().trim().min(1, "Role on project is required"),
  hours_per_week: z.number().positive("Hours must be greater than 0"),
  start_date: isoDate,
  end_date: isoDate.optional(),
});
export type ProposedAllocationInput = z.infer<typeof ProposedAllocationInput>;

export const ProjectProposalInput = z.object({
  project: ProjectInput,
  allocations: z.array(ProposedAllocationInput).min(1, "Add at least one tester assignment"),
});
export type ProjectProposalInput = z.infer<typeof ProjectProposalInput>;
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: error set narrows further (schema files now clean); action/UI files still flagged until their own tasks land.

- [ ] **Step 6: Commit**

```bash
git add src/features/qa-group-schema.ts src/features/product-schema.ts src/features/profile-schema.ts src/features/project-schema.ts
git commit -m "feat: add v3 Zod schemas — QaGroupInput, ProductInput, qa_group_id/product_id fields"
```

---

### Task 4: QA Group & Product server actions

**Files:**
- Create: `src/features/qa-group-action.ts`
- Create: `src/features/product-action.ts`

**Interfaces:**
- Consumes: `QaGroupInput` / `ProductInput` (Task 3), `QaGroupRow` / `ProductRow` (Task 2), `requireRole`/`createAdminClient`/`createClient` (v1 patterns).
- Produces: `getQaGroups(): Promise<QaGroupRow[]>`, `createQaGroup`/`updateQaGroup`/`deleteQaGroup` (QA-Lead-only) from `@/features/qa-group-action`; the identical shape for products from `@/features/product-action`. Consumed starting Task 5 (Settings UI) and every later task that resolves a group/product name.

- [ ] **Step 1: Write `src/features/qa-group-action.ts`**

```ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { QaGroupInput } from "@/features/qa-group-schema";
import type { QaGroupRow } from "@/lib/qa-group";

export async function getQaGroups(): Promise<QaGroupRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("qa_groups").select("id, name").order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as QaGroupRow[];
}

function friendlyError(error: { code?: string; message: string }): Error {
  if (error.code === "23505") return new Error("A QA Group with that name already exists");
  return new Error(error.message);
}

export async function createQaGroup(input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = QaGroupInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("qa_groups").insert({ name: parsed.data.name });
  if (error) throw friendlyError(error);
  return { success: true };
}

export async function updateQaGroup(id: string, input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = QaGroupInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("qa_groups").update({ name: parsed.data.name }).eq("id", id);
  if (error) throw friendlyError(error);
  return { success: true };
}

export async function deleteQaGroup(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();

  const { count, error: countError } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("qa_group_id", id);
  if (countError) throw new Error(countError.message);
  if (count && count > 0) {
    throw new Error(`Can't delete: ${count} QA(s) are still in this group`);
  }

  const { error } = await admin.from("qa_groups").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}
```

- [ ] **Step 2: Write `src/features/product-action.ts`**

```ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ProductInput } from "@/features/product-schema";
import type { ProductRow } from "@/lib/product";

export async function getProducts(): Promise<ProductRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("products").select("id, name").order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductRow[];
}

function friendlyError(error: { code?: string; message: string }): Error {
  if (error.code === "23505") return new Error("A Product with that name already exists");
  return new Error(error.message);
}

export async function createProduct(input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = ProductInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("products").insert({ name: parsed.data.name });
  if (error) throw friendlyError(error);
  return { success: true };
}

export async function updateProduct(id: string, input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = ProductInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("products").update({ name: parsed.data.name }).eq("id", id);
  if (error) throw friendlyError(error);
  return { success: true };
}

export async function deleteProduct(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();

  const { count, error: countError } = await admin
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("product_id", id);
  if (countError) throw new Error(countError.message);
  if (count && count > 0) {
    throw new Error(`Can't delete: ${count} project(s) use this product`);
  }

  const { error } = await admin.from("products").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` — expected error set unchanged from Task 3 (this task's own files are clean).
Run: `npx eslint src/features/qa-group-action.ts src/features/product-action.ts`
Expected: zero errors/warnings.

- [ ] **Step 4: Commit**

```bash
git add src/features/qa-group-action.ts src/features/product-action.ts
git commit -m "feat: add QA Group and Product CRUD server actions"
```

---

### Task 5: Settings UI — shared NameEntityCard + wire QA Groups/Products

**Files:**
- Create: `src/components/settings/name-entity-card.tsx`
- Modify: `src/components/settings/settings-page-content.tsx`

**Interfaces:**
- Consumes: `getQaGroups`/`createQaGroup`/`updateQaGroup`/`deleteQaGroup` (Task 4), `getProducts`/`createProduct`/`updateProduct`/`deleteProduct` (Task 4).
- Produces: `NameEntityCard` from `@/components/settings/name-entity-card` — a generic id+name CRUD card, parameterized by the caller's query/mutation functions. Consumed only by this task's Settings page (two instances). No exports consumed by other tasks (leaf feature).

- [ ] **Step 1: Write `src/components/settings/name-entity-card.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type NameEntity = { id: string; name: string };

type NameEntityCardProps = {
  title: string;
  itemNoun: string;
  queryKey: string;
  getItems: () => Promise<NameEntity[]>;
  createItem: (input: unknown) => Promise<{ success: true }>;
  updateItem: (id: string, input: unknown) => Promise<{ success: true }>;
  deleteItem: (id: string) => Promise<{ success: true }>;
};

export function NameEntityCard({
  title,
  itemNoun,
  queryKey,
  getItems,
  createItem,
  updateItem,
  deleteItem,
}: NameEntityCardProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<NameEntity | null>(null);
  const [deletingItem, setDeletingItem] = useState<NameEntity | null>(null);
  const [name, setName] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: [queryKey],
    queryFn: () => getItems(),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: [queryKey] });
  }

  const createMutation = useMutation({
    mutationFn: () => createItem({ name }),
    onSuccess: () => {
      toast.success(`${itemNoun} added`);
      invalidate();
      setName("");
      setAddOpen(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: () => updateItem(editingItem!.id, { name }),
    onSuccess: () => {
      toast.success(`${itemNoun} updated`);
      invalidate();
      setEditingItem(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteItem(id),
    onSuccess: () => {
      toast.success(`${itemNoun} deleted`);
      invalidate();
      setDeletingItem(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function openAdd() {
    setName("");
    setAddOpen(true);
  }

  function openEdit(item: NameEntity) {
    setName(item.name);
    setEditingItem(item);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Button size="sm" variant="outline" onClick={openAdd}>
          <Plus className="size-4" />
          Add
        </Button>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Name</TableHead>
              <TableHead className="pr-6 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={2} className="py-8 text-center text-sm text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : !data || data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="py-8 text-center text-sm text-muted-foreground">
                  No {itemNoun.toLowerCase()}s yet.
                </TableCell>
              </TableRow>
            ) : (
              data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="pl-6 text-sm font-medium">{item.name}</TableCell>
                  <TableCell className="pr-6 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" aria-label="Row actions">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openEdit(item)}>
                          <Pencil className="size-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setDeletingItem(item)}
                          className="text-rose-600 focus:text-rose-600"
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add {itemNoun}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              createMutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor={`${queryKey}-add-name`}>Name</Label>
              <Input id={`${queryKey}-add-name`} value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Saving..." : "Add"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingItem !== null}
        onOpenChange={(o) => {
          if (!o) setEditingItem(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit {itemNoun}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              updateMutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor={`${queryKey}-edit-name`}>Name</Label>
              <Input id={`${queryKey}-edit-name`} value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deletingItem !== null}
        onOpenChange={(o) => {
          if (!o) setDeletingItem(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {itemNoun.toLowerCase()}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes &ldquo;{deletingItem?.name}&rdquo;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deletingItem) deleteMutation.mutate(deletingItem.id);
              }}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
```

- [ ] **Step 2: Wire two instances into `src/components/settings/settings-page-content.tsx`**

Full replacement:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NameEntityCard } from "@/components/settings/name-entity-card";
import { getSettings, updateSettings } from "@/features/settings-action";
import { createProduct, deleteProduct, getProducts, updateProduct } from "@/features/product-action";
import { createQaGroup, deleteQaGroup, getQaGroups, updateQaGroup } from "@/features/qa-group-action";

export function SettingsPageContent() {
  const [maxParallelProjects, setMaxParallelProjects] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => getSettings(),
  });

  if (data && maxParallelProjects === null) {
    setMaxParallelProjects(String(data.max_parallel_projects));
  }

  const mutation = useMutation({
    mutationFn: () => updateSettings({ max_parallel_projects: Number(maxParallelProjects) }),
    onSuccess: () => {
      toast.success("Settings updated");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Global limits and defaults for the QA Resource Manager.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
            className="max-w-xs space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="max_parallel">Max Parallel Projects per QA</Label>
              <Input
                id="max_parallel"
                type="number"
                min={1}
                step={1}
                value={maxParallelProjects ?? ""}
                onChange={(e) => setMaxParallelProjects(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                A QA can&apos;t be assigned to more than this many overlapping projects/activities at once.
              </p>
            </div>
            <Button type="submit" disabled={mutation.isPending || maxParallelProjects === null}>
              {mutation.isPending ? "Saving..." : "Save"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <NameEntityCard
        title="QA Groups"
        itemNoun="QA Group"
        queryKey="qa-groups"
        getItems={getQaGroups}
        createItem={createQaGroup}
        updateItem={updateQaGroup}
        deleteItem={deleteQaGroup}
      />

      <NameEntityCard
        title="Products"
        itemNoun="Product"
        queryKey="products"
        getItems={getProducts}
        createItem={createProduct}
        updateItem={updateProduct}
        deleteItem={deleteProduct}
      />
    </div>
  );
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` — expected error set unchanged from Task 4 (this task's own files are clean).
Run: `npx eslint src/components/settings`
Expected: zero errors/warnings.

- [ ] **Step 4: Manual smoke check**

`npm run dev`, sign in as QA Lead, open `/settings`. Confirm "QA Groups" and "Products" cards each list their seeded rows. Add a new QA Group, confirm it appears immediately. Edit an existing Product's name, confirm the table updates. Try deleting a QA Group that's still assigned to a team member — confirm the friendly "Can't delete: N QA(s)..." error. Delete a newly-added, unused QA Group — confirm it disappears.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/name-entity-card.tsx src/components/settings/settings-page-content.tsx
git commit -m "feat: add QA Groups and Products CRUD cards to Settings"
```

---

### Task 6: Team Management — dynamic QA Group

**Files:**
- Modify: `src/features/profile-action.ts`
- Modify: `src/components/team/team-form-dialog.tsx`
- Modify: `src/components/team/team-table.tsx`

**Interfaces:**
- Consumes: `getQaGroups` (Task 4), updated `ProfileInput`/`ProfileUpdateInput` (Task 3), `Profile.qa_group_id` (Task 2).
- Produces: same exported function names as v1/v2 (`getProfiles`, `getAssignableProfiles`, `createProfile`, `updateProfile`, `setProfileActive`, `resetPassword`) but `createProfile`/`updateProfile` now read/write `qa_group_id`. No exports consumed by other tasks beyond what already existed.

- [ ] **Step 1: Update `createProfile`/`updateProfile` in `src/features/profile-action.ts`**

Change the two `qa_group: parsed.data.qa_group ?? null` lines (in `createProfile`'s insert and `updateProfile`'s update) to `qa_group_id: parsed.data.qa_group_id ?? null`. Full file:

```ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ProfileInput, ProfileUpdateInput } from "@/features/profile-schema";
import type { Profile } from "@/lib/profile";

function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return password;
}

export async function getProfiles(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("*").order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

export async function getAssignableProfiles(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_active", true)
    .in("role", ["qa_lead", "qa_member"])
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

export async function createProfile(
  input: unknown,
): Promise<{ profile: Profile; tempPassword: string }> {
  await requireRole(["qa_lead"]);

  const parsed = ProfileInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const tempPassword = generateTempPassword();

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: tempPassword,
    email_confirm: true,
  });
  if (authError || !authUser.user) {
    throw new Error(authError?.message ?? "Failed to create a login for this user");
  }

  const { data: profile, error: insertError } = await admin
    .from("profiles")
    .insert({
      id: authUser.user.id,
      name: parsed.data.name,
      email: parsed.data.email,
      role: parsed.data.role,
      qa_group_id: parsed.data.qa_group_id ?? null,
      capacity_hours: parsed.data.capacity_hours,
    })
    .select("*")
    .single();

  if (insertError || !profile) {
    await admin.auth.admin.deleteUser(authUser.user.id);
    throw new Error(insertError?.message ?? "Failed to create profile");
  }

  return { profile: profile as Profile, tempPassword };
}

export async function updateProfile(id: string, input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = ProfileUpdateInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({
      name: parsed.data.name,
      role: parsed.data.role,
      qa_group_id: parsed.data.qa_group_id ?? null,
      capacity_hours: parsed.data.capacity_hours,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return { success: true };
}

export async function setProfileActive(id: string, isActive: boolean): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function resetPassword(id: string): Promise<{ tempPassword: string }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const tempPassword = generateTempPassword();

  const { error } = await admin.auth.admin.updateUserById(id, { password: tempPassword });
  if (error) throw new Error(error.message);

  return { tempPassword };
}
```

- [ ] **Step 2: Update `src/components/team/team-form-dialog.tsx`**

Full replacement:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createProfile, updateProfile } from "@/features/profile-action";
import { getQaGroups } from "@/features/qa-group-action";
import type { Profile, ProfileRole } from "@/lib/profile";

type FormState = {
  name: string;
  email: string;
  role: ProfileRole;
  qa_group_id: string; // "none" sentinel, or a qa_groups.id
  capacity_hours: string;
};

function formFromProfile(profile?: Profile): FormState {
  return profile
    ? {
        name: profile.name,
        email: profile.email,
        role: profile.role,
        qa_group_id: profile.qa_group_id ?? "none",
        capacity_hours: String(profile.capacity_hours),
      }
    : { name: "", email: "", role: "qa_member", qa_group_id: "none", capacity_hours: "40" };
}

type TeamFormDialogProps = {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue?: Profile;
};

export function TeamFormDialog({ mode, open, onOpenChange, initialValue }: TeamFormDialogProps) {
  const isEdit = mode === "edit";
  const [form, setForm] = useState<FormState>(() => formFromProfile(initialValue));
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: qaGroups } = useQuery({
    queryKey: ["qa-groups"],
    queryFn: () => getQaGroups(),
  });

  const mutation = useMutation<
    { profile: Profile; tempPassword: string } | { success: true },
    Error,
    void
  >({
    mutationFn: () => {
      const payload = {
        name: form.name,
        email: form.email,
        role: form.role,
        qa_group_id: form.qa_group_id === "none" ? undefined : form.qa_group_id,
        capacity_hours: Number(form.capacity_hours),
      };
      return isEdit && initialValue
        ? updateProfile(initialValue.id, payload)
        : createProfile(payload);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      if (!isEdit && result && "tempPassword" in result) {
        setTempPassword(result.tempPassword);
      } else {
        toast.success("Team member updated");
        onOpenChange(false);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setTempPassword(null);
      setForm(formFromProfile());
    }
    onOpenChange(nextOpen);
  }

  if (tempPassword) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>User created</DialogTitle>
            <DialogDescription>
              Share this temporary password with {form.name} — it will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted px-4 py-3 text-center font-mono text-lg tracking-wider">
            {tempPassword}
          </div>
          <DialogFooter>
            <Button onClick={() => handleClose(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit user" : "Add user"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this team member's details." : "Creates a profile and a login for this team member."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              disabled={isEdit}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={form.role} onValueChange={(value) => setForm((f) => ({ ...f, role: value as ProfileRole }))}>
                <SelectTrigger id="role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qa_lead">QA Lead</SelectItem>
                  <SelectItem value="qa_member">QA Member</SelectItem>
                  <SelectItem value="project_manager">Project Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
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
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="qa_group">QA Group</Label>
            <Select
              value={form.qa_group_id}
              onValueChange={(value) => setForm((f) => ({ ...f, qa_group_id: value }))}
            >
              <SelectTrigger id="qa_group" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {(qaGroups ?? []).map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : isEdit ? "Save" : "Add user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Update `src/components/team/team-table.tsx`**

Full replacement — same file as before with `QA_GROUP_LABEL` removed and replaced by a `getQaGroups()`-sourced lookup:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, MoreHorizontal, Pencil, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TeamFormDialog } from "@/components/team/team-form-dialog";
import { resetPassword, setProfileActive } from "@/features/profile-action";
import { getQaGroups } from "@/features/qa-group-action";
import type { Profile, ProfileRole } from "@/lib/profile";

const ROLE_LABEL: Record<ProfileRole, string> = {
  qa_lead: "QA Lead",
  qa_member: "QA Member",
  project_manager: "Project Manager",
};

type TeamTableProps = {
  rows: Profile[];
  isLoading: boolean;
  isError: boolean;
  canWrite: boolean;
};

export function TeamTable({ rows, isLoading, isError, canWrite }: TeamTableProps) {
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [resetPasswordFor, setResetPasswordFor] = useState<Profile | null>(null);
  const [newTempPassword, setNewTempPassword] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: qaGroups } = useQuery({
    queryKey: ["qa-groups"],
    queryFn: () => getQaGroups(),
  });
  const qaGroupNameById = new Map((qaGroups ?? []).map((g) => [g.id, g.name]));

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => setProfileActive(id, isActive),
    onSuccess: () => {
      toast.success("Team member updated");
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (id: string) => resetPassword(id),
    onSuccess: (result) => setNewTempPassword(result.tempPassword),
    onError: (error: Error) => {
      toast.error(error.message);
      setResetPasswordFor(null);
    },
  });

  const columnCount = canWrite ? 6 : 5;

  return (
    <Card>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>QA Group</TableHead>
              <TableHead className="text-right">Capacity (hrs/wk)</TableHead>
              {canWrite && <TableHead className="pr-6 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-6"><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="ml-auto h-4 w-10" /></TableCell>
                  {canWrite && <TableCell className="pr-6"><Skeleton className="ml-auto size-8 rounded-md" /></TableCell>}
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-8 text-center text-sm text-muted-foreground">
                  Failed to load team members.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-8 text-center text-sm text-muted-foreground">
                  No team members yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((profile) => (
                <TableRow key={profile.id} className={!profile.is_active ? "opacity-50" : undefined}>
                  <TableCell className="pl-6 text-sm font-medium">{profile.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{profile.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{ROLE_LABEL[profile.role]}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {profile.qa_group_id ? (qaGroupNameById.get(profile.qa_group_id) ?? "—") : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{profile.capacity_hours}</TableCell>
                  {canWrite && (
                    <TableCell className="pr-6 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" aria-label="Row actions">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditingProfile(profile)}>
                            <Pencil className="size-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              setResetPasswordFor(profile);
                              resetPasswordMutation.mutate(profile.id);
                            }}
                          >
                            <KeyRound className="size-4" />
                            Reset Password
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              toggleActiveMutation.mutate({ id: profile.id, isActive: !profile.is_active })
                            }
                          >
                            {profile.is_active ? (
                              <>
                                <UserX className="size-4" />
                                Deactivate
                              </>
                            ) : (
                              <>
                                <UserCheck className="size-4" />
                                Reactivate
                              </>
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      {editingProfile && (
        <TeamFormDialog
          key={editingProfile.id}
          mode="edit"
          open
          onOpenChange={(o) => {
            if (!o) setEditingProfile(null);
          }}
          initialValue={editingProfile}
        />
      )}

      <Dialog
        open={resetPasswordFor !== null}
        onOpenChange={(o) => {
          if (!o) {
            setResetPasswordFor(null);
            setNewTempPassword(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Password reset</DialogTitle>
            <DialogDescription>
              {newTempPassword
                ? `Share this temporary password with ${resetPasswordFor?.name} — it will not be shown again.`
                : "Generating a new temporary password..."}
            </DialogDescription>
          </DialogHeader>
          {newTempPassword && (
            <div className="rounded-md border bg-muted px-4 py-3 text-center font-mono text-lg tracking-wider">
              {newTempPassword}
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={!newTempPassword}
              onClick={() => {
                setResetPasswordFor(null);
                setNewTempPassword(null);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

Note: `team-page-content.tsx` needs no change — it only threads `Profile[]` through, and `Profile` already carries `qa_group_id` from Task 2.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: `src/features/profile-action.ts`, `src/components/team/team-form-dialog.tsx`, `src/components/team/team-table.tsx` no longer appear in the error list.
Run: `npx eslint src/features/profile-action.ts src/components/team`
Expected: zero errors/warnings.

- [ ] **Step 5: Commit**

```bash
git add src/features/profile-action.ts src/components/team/team-form-dialog.tsx src/components/team/team-table.tsx
git commit -m "feat: source QA Group selection dynamically on Team Management"
```

---

### Task 7: Project Portfolio server actions — product_id

**Files:**
- Modify: `src/features/project-action.ts`

**Interfaces:**
- Consumes: updated `ProjectInput`/`ProjectProposalInput` (Task 3), `Project` (Task 2, now carries `product_id`).
- Produces: same exported function names as v1/v2 (`getProjects`, `createProject`, `updateProject`, `deleteProject`, `proposeProject`, `withdrawProjectProposal`) but `getProjects`'s filter param is renamed `product` → `product_id: string`, and `createProject`/`updateProject`/`proposeProject` read/write `product_id` instead of `product`. Consumed starting Task 9.

- [ ] **Step 1: Replace `src/features/project-action.ts`**

```ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ProjectInput, ProjectProposalInput } from "@/features/project-schema";
import type { Project, ProjectStatus, ApprovalStatus } from "@/lib/project";

export async function getProjects({
  status = "",
  product_id = "",
  search = "",
  approvalStatus,
}: {
  status?: ProjectStatus | "";
  product_id?: string;
  search?: string;
  approvalStatus?: ApprovalStatus;
} = {}): Promise<Project[]> {
  const supabase = await createClient();

  let query = supabase.from("projects").select("*");

  const term = search.trim();
  if (term) query = query.ilike("name", `%${term}%`);
  if (status) query = query.eq("status", status);
  if (product_id) query = query.eq("product_id", product_id);
  if (approvalStatus) query = query.eq("approval_status", approvalStatus);

  const { data, error } = await query.order("start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Project[];
}

export async function createProject(input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = ProjectInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("projects").insert({
    name: parsed.data.name,
    item_type: parsed.data.item_type,
    start_date: parsed.data.start_date,
    end_date: parsed.data.end_date,
    product_id: parsed.data.product_id,
    status: parsed.data.status,
    progress_percent: parsed.data.status === "completed" ? 100 : parsed.data.progress_percent,
    total_working_hours: parsed.data.total_working_hours,
    priority: parsed.data.priority,
    approval_status: "approved",
  });

  if (error) throw new Error(error.message);
  return { success: true };
}

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * When a work item is marked Completed: reject any pending allocation
 * proposal on it, clear any pending rebaseline change, close out ongoing
 * approved allocations (end_date = today), and delete approved allocations
 * that hadn't started yet. Idempotent — safe to run even if some rows are
 * already in their target state.
 */
async function releaseAllocationsForCompletedProject(admin: AdminClient, projectId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: allocations, error } = await admin
    .from("allocations")
    .select("id, start_date, end_date, approval_status, proposed_start_date")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);

  for (const allocation of allocations ?? []) {
    if (allocation.approval_status === "pending") {
      await admin.from("allocations").update({ approval_status: "rejected" }).eq("id", allocation.id);
      continue;
    }

    if (allocation.approval_status !== "approved") continue;

    const updates: Record<string, unknown> = {};

    if (allocation.proposed_start_date !== null) {
      updates.proposed_start_date = null;
      updates.proposed_end_date = null;
      updates.proposed_hours_per_week = null;
      updates.proposed_priority = null;
      updates.change_proposed_by = null;
      updates.change_requested_at = null;
    }

    if (allocation.start_date > today) {
      await admin.from("allocations").delete().eq("id", allocation.id);
      continue;
    }

    if (allocation.end_date === null || allocation.end_date > today) {
      updates.end_date = today;
    }

    if (Object.keys(updates).length > 0) {
      await admin.from("allocations").update(updates).eq("id", allocation.id);
    }
  }
}

export async function updateProject(id: string, input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = ProjectInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const becomingCompleted = parsed.data.status === "completed";

  const { error } = await admin
    .from("projects")
    .update({
      name: parsed.data.name,
      item_type: parsed.data.item_type,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      product_id: parsed.data.product_id,
      status: parsed.data.status,
      progress_percent: becomingCompleted ? 100 : parsed.data.progress_percent,
      total_working_hours: parsed.data.total_working_hours,
      priority: parsed.data.priority,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);

  if (becomingCompleted) {
    await releaseAllocationsForCompletedProject(admin, id);
  }

  return { success: true };
}

export async function deleteProject(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error } = await admin.from("projects").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function proposeProject(input: unknown): Promise<{ success: true }> {
  const profile = await requireRole(["project_manager"]);

  const parsed = ProjectProposalInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: project, error: projectError } = await admin
    .from("projects")
    .insert({
      name: parsed.data.project.name,
      item_type: parsed.data.project.item_type,
      start_date: parsed.data.project.start_date,
      end_date: parsed.data.project.end_date,
      product_id: parsed.data.project.product_id,
      status: parsed.data.project.status,
      progress_percent: parsed.data.project.progress_percent,
      total_working_hours: parsed.data.project.total_working_hours,
      priority: parsed.data.project.priority,
      approval_status: "pending",
      proposed_by: profile.id,
    })
    .select("id")
    .single();

  if (projectError || !project) {
    throw new Error(projectError?.message ?? "Failed to submit proposal");
  }

  const { error: allocationsError } = await admin.from("allocations").insert(
    parsed.data.allocations.map((allocation) => ({
      user_id: allocation.user_id,
      project_id: project.id,
      role_on_project: allocation.role_on_project,
      hours_per_week: allocation.hours_per_week,
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

  return { success: true };
}

export async function withdrawProjectProposal(id: string): Promise<{ success: true }> {
  const profile = await requireRole(["project_manager"]);

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("proposed_by, approval_status")
    .eq("id", id)
    .single();

  if (!project || project.proposed_by !== profile.id || project.approval_status !== "pending") {
    throw new Error("This proposal can no longer be withdrawn");
  }

  const { error } = await admin.from("projects").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: `src/features/project-action.ts` no longer appears in the error list.

- [ ] **Step 3: Commit**

```bash
git add src/features/project-action.ts
git commit -m "feat: switch project actions to product_id"
```

---

### Task 8: Allocation actions — per-project visibility

**Files:**
- Modify: `src/features/allocation-action.ts`

**Interfaces:**
- Consumes: nothing new (same file, same imports).
- Produces: new `getAllocationsForProject(projectId): Promise<Allocation[]>` and `getApprovedAllocationCountsByProject(): Promise<Record<string, number>>` from `@/features/allocation-action`, appended after the existing exports. Consumed by Task 9 (Project Portfolio UI's Assigned column and `ProjectAssignmentsDialog`).

- [ ] **Step 1: Append two functions to the end of `src/features/allocation-action.ts`**

Add after `createBulkAllocations` (end of file), leaving everything else unchanged:

```ts
export async function getAllocationsForProject(projectId: string): Promise<Allocation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("allocations")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Allocation[];
}

export async function getApprovedAllocationCountsByProject(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("allocations")
    .select("project_id")
    .eq("approval_status", "approved");
  if (error) throw new Error(error.message);

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.project_id] = (counts[row.project_id] ?? 0) + 1;
  }
  return counts;
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit` — expected error set unchanged (no new errors, `allocation-action.ts` was already clean).
Run: `npx eslint src/features/allocation-action.ts`
Expected: zero errors/warnings.

- [ ] **Step 3: Commit**

```bash
git add src/features/allocation-action.ts
git commit -m "feat: add per-project allocation lookups for the Assigned QAs view"
```

---

### Task 9: Project Portfolio UI — dynamic Product, Assigned QAs view

**Files:**
- Modify: `src/components/projects/project-form-dialog.tsx`
- Modify: `src/components/projects/propose-project-dialog.tsx`
- Modify: `src/components/projects/project-table.tsx`
- Modify: `src/components/projects/projects-page-content.tsx`
- Create: `src/components/projects/project-assignments-dialog.tsx`

**Interfaces:**
- Consumes: `getProducts` (Task 4), `getAllocationsForProject`/`getApprovedAllocationCountsByProject` (Task 8), `getProfiles` (v1 `@/features/profile-action`), updated `createProject`/`updateProject`/`proposeProject`/`getProjects` (Task 7), `Project.product_id` (Task 2).
- Produces: `ProjectAssignmentsDialog` from `@/components/projects/project-assignments-dialog` — read-only, consumed only by this task's `ProjectTable`. The `/projects` route fully updated for v3. No exports consumed by other tasks (leaf feature).

- [ ] **Step 1: Replace `src/components/projects/project-form-dialog.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createProject, updateProject } from "@/features/project-action";
import { getProducts } from "@/features/product-action";
import type { ItemType, Priority, Project, ProjectStatus } from "@/lib/project";

type FormState = {
  name: string;
  item_type: ItemType;
  start_date: string;
  end_date: string;
  product_id: string;
  status: ProjectStatus;
  progress_percent: string;
  total_working_hours: string;
  priority: Priority;
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
        total_working_hours: String(project.total_working_hours),
        priority: project.priority,
      }
    : {
        name: "",
        item_type: "project",
        start_date: "",
        end_date: "",
        product_id: "",
        status: "to_do",
        progress_percent: "0",
        total_working_hours: "",
        priority: "medium",
      };
}

type ProjectFormDialogProps = {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue?: Project;
};

export function ProjectFormDialog({ mode, open, onOpenChange, initialValue }: ProjectFormDialogProps) {
  const isEdit = mode === "edit";
  const [form, setForm] = useState<FormState>(() => formFromProject(initialValue));
  const queryClient = useQueryClient();

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });

  const mutation = useMutation<{ success: true }, Error, void>({
    mutationFn: () => {
      const payload = {
        name: form.name,
        item_type: form.item_type,
        start_date: form.start_date,
        end_date: form.end_date,
        product_id: form.product_id,
        status: form.status,
        progress_percent: Number(form.progress_percent),
        total_working_hours: Number(form.total_working_hours),
        priority: form.priority,
      };
      return isEdit && initialValue ? updateProject(initialValue.id, payload) : createProject(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Item updated" : "Item created");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      if (!isEdit) setForm(formFromProject());
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit item" : "New item"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="item_type">Item Type</Label>
            <Select value={form.item_type} onValueChange={(value) => setForm((f) => ({ ...f, item_type: value as ItemType }))}>
              <SelectTrigger id="item_type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project">Project</SelectItem>
                <SelectItem value="support_testing">Support Testing</SelectItem>
                <SelectItem value="problem_incident">Problem Incident</SelectItem>
                <SelectItem value="service_request">Service Request</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start_date">Start Date</Label>
              <Input
                id="start_date"
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_date">End Date</Label>
              <Input
                id="end_date"
                type="date"
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
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
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={form.status} onValueChange={(value) => setForm((f) => ({ ...f, status: value as ProjectStatus }))}>
                <SelectTrigger id="status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="to_do">To Do</SelectItem>
                  <SelectItem value="ready_sit">Ready to SIT</SelectItem>
                  <SelectItem value="sit">SIT</SelectItem>
                  <SelectItem value="ready_uat">Ready to UAT</SelectItem>
                  <SelectItem value="uat">UAT</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="total_working_hours">Total Working Hours</Label>
              <Input
                id="total_working_hours"
                type="number"
                min={1}
                step={1}
                value={form.total_working_hours}
                onChange={(e) => setForm((f) => ({ ...f, total_working_hours: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select value={form.priority} onValueChange={(value) => setForm((f) => ({ ...f, priority: value as Priority }))}>
                <SelectTrigger id="priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.status !== "completed" && (
            <div className="space-y-2">
              <Label htmlFor="progress">Progress %</Label>
              <Input
                id="progress"
                type="number"
                min={0}
                max={100}
                step={1}
                value={form.progress_percent}
                onChange={(e) => setForm((f) => ({ ...f, progress_percent: e.target.value }))}
                required
              />
            </div>
          )}

          {isEdit && form.status === "completed" && (
            <p className="text-xs text-muted-foreground">
              Progress is locked at 100% once Completed, and every assignment on this item will be closed out
              (ongoing ones end today; not-yet-started ones are removed) when you save.
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !form.product_id}>
              {mutation.isPending ? "Saving..." : isEdit ? "Save" : "Create item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Replace `src/components/projects/propose-project-dialog.tsx`**

Same structure as v2, `product` state renamed `productId`, sourced from `getProducts()`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAssignableProfiles } from "@/features/profile-action";
import { getProducts } from "@/features/product-action";
import { proposeProject } from "@/features/project-action";
import type { ItemType, Priority, ProjectStatus } from "@/lib/project";

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

type ProposeProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProposeProjectDialog({ open, onOpenChange }: ProposeProjectDialogProps) {
  const [name, setName] = useState("");
  const [itemType, setItemType] = useState<ItemType>("project");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [productId, setProductId] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("to_do");
  const [totalWorkingHours, setTotalWorkingHours] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [rows, setRows] = useState<AllocationRow[]>([emptyAllocationRow()]);
  const queryClient = useQueryClient();

  const { data: testers } = useQuery({
    queryKey: ["assignable-profiles"],
    queryFn: () => getAssignableProfiles(),
  });

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });

  const mutation = useMutation({
    mutationFn: () =>
      proposeProject({
        project: {
          name,
          item_type: itemType,
          start_date: startDate,
          end_date: endDate,
          product_id: productId,
          status,
          progress_percent: 0,
          total_working_hours: Number(totalWorkingHours),
          priority,
        },
        allocations: rows.map((row) => ({
          user_id: row.user_id,
          role_on_project: row.role_on_project,
          hours_per_week: Number(row.hours_per_week),
          start_date: row.start_date,
          end_date: row.end_date || undefined,
        })),
      }),
    onSuccess: () => {
      toast.success("Proposal submitted — pending QA Lead approval");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setName("");
      setStartDate("");
      setEndDate("");
      setTotalWorkingHours("");
      setRows([emptyAllocationRow()]);
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function updateRow(index: number, patch: Partial<AllocationRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Propose item</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="proposal_name">Name</Label>
            <Input id="proposal_name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="proposal_item_type">Item Type</Label>
            <Select value={itemType} onValueChange={(value) => setItemType(value as ItemType)}>
              <SelectTrigger id="proposal_item_type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project">Project</SelectItem>
                <SelectItem value="support_testing">Support Testing</SelectItem>
                <SelectItem value="problem_incident">Problem Incident</SelectItem>
                <SelectItem value="service_request">Service Request</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="proposal_start">Start Date</Label>
              <Input id="proposal_start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal_end">End Date</Label>
              <Input id="proposal_end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
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
            <div className="space-y-2">
              <Label htmlFor="proposal_status">Status</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as ProjectStatus)}>
                <SelectTrigger id="proposal_status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="to_do">To Do</SelectItem>
                  <SelectItem value="ready_sit">Ready to SIT</SelectItem>
                  <SelectItem value="sit">SIT</SelectItem>
                  <SelectItem value="ready_uat">Ready to UAT</SelectItem>
                  <SelectItem value="uat">UAT</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="proposal_hours">Total Working Hours</Label>
              <Input
                id="proposal_hours"
                type="number"
                min={1}
                step={1}
                value={totalWorkingHours}
                onChange={(e) => setTotalWorkingHours(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal_priority">Priority</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
                <SelectTrigger id="proposal_priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Tester Assignments</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setRows((r) => [...r, emptyAllocationRow()])}>
                <Plus className="size-4" />
                Add tester
              </Button>
            </div>

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
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Start</Label>
                  <Input type="date" value={row.start_date} onChange={(e) => updateRow(index, { start_date: e.target.value })} required />
                </div>
                <div className="col-span-1 space-y-1">
                  <Label className="text-xs">End</Label>
                  <Input type="date" value={row.end_date} onChange={(e) => updateRow(index, { end_date: e.target.value })} />
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={rows.length === 1}
                    onClick={() => setRows((r) => r.filter((_, i) => i !== index))}
                    aria-label="Remove tester row"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !productId}>
              {mutation.isPending ? "Submitting..." : "Submit proposal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Write `src/components/projects/project-assignments-dialog.tsx`**

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAllocationsForProject } from "@/features/allocation-action";
import { getProfiles } from "@/features/profile-action";
import { formatDate } from "@/lib/format";
import type { Priority, Project } from "@/lib/project";

const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

type ProjectAssignmentsDialogProps = {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProjectAssignmentsDialog({ project, open, onOpenChange }: ProjectAssignmentsDialogProps) {
  const { data: allocations, isLoading } = useQuery({
    queryKey: ["allocations", "project", project.id],
    queryFn: () => getAllocationsForProject(project.id),
  });

  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => getProfiles(),
  });
  const profileNameById = new Map((profiles ?? []).map((p) => [p.id, p.name]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Assigned QAs — {project.name}</DialogTitle>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>QA</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Hours/Wk</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Timeline</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : !allocations || allocations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No QAs assigned to this item yet.
                </TableCell>
              </TableRow>
            ) : (
              allocations.map((allocation) => (
                <TableRow key={allocation.id}>
                  <TableCell className="text-sm font-medium">
                    {profileNameById.get(allocation.user_id) ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{allocation.role_on_project}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {Math.round(allocation.hours_per_week * 10) / 10}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{PRIORITY_LABEL[allocation.priority]}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(allocation.start_date)} –{" "}
                    {allocation.end_date ? formatDate(allocation.end_date) : "Ongoing"}
                  </TableCell>
                  <TableCell>
                    {allocation.approval_status === "approved" && (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        Approved
                      </Badge>
                    )}
                    {allocation.approval_status === "pending" && (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                        Pending
                      </Badge>
                    )}
                    {allocation.approval_status === "rejected" && (
                      <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                        Rejected
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Replace `src/components/projects/project-table.tsx`**

Adds a `productNameById`/`assignmentCounts` prop pair (fetched once by `projects-page-content.tsx` in Step 5, so both this table and the page's own filter share one fetch), an "Assigned" column, and the `ProjectAssignmentsDialog` trigger:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectAssignmentsDialog } from "@/components/projects/project-assignments-dialog";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { deleteProject, withdrawProjectProposal } from "@/features/project-action";
import { formatDate } from "@/lib/format";
import type { ItemType, Priority, Project, ProjectStatus } from "@/lib/project";
import type { ProfileRole } from "@/lib/profile";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  to_do: "To Do",
  ready_sit: "Ready to SIT",
  sit: "SIT",
  ready_uat: "Ready to UAT",
  uat: "UAT",
  completed: "Completed",
};

const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  project: "Project",
  support_testing: "Support Testing",
  problem_incident: "Problem Incident",
  service_request: "Service Request",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

const PRIORITY_BADGE_CLASS: Record<Priority, string> = {
  low: "border-slate-200 bg-slate-50 text-slate-700",
  medium: "border-blue-200 bg-blue-50 text-blue-700",
  high: "border-amber-200 bg-amber-50 text-amber-700",
  critical: "border-rose-200 bg-rose-50 text-rose-700",
};

type ProjectTableProps = {
  rows: Project[];
  isLoading: boolean;
  isError: boolean;
  role: ProfileRole;
  currentProfileId: string;
  productNameById: Map<string, string>;
  assignmentCounts: Record<string, number>;
};

export function ProjectTable({
  rows,
  isLoading,
  isError,
  role,
  currentProfileId,
  productNameById,
  assignmentCounts,
}: ProjectTableProps) {
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [viewingProject, setViewingProject] = useState<Project | null>(null);
  const queryClient = useQueryClient();

  const canEdit = role === "qa_lead";
  const canPropose = role === "project_manager";
  const showActions = canEdit || canPropose;
  const columnCount = showActions ? 10 : 9;

  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      toast.success("Item deleted");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDeletingProject(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const withdrawMutation = useMutation({
    mutationFn: withdrawProjectProposal,
    onSuccess: () => {
      toast.success("Proposal withdrawn");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Start Date</TableHead>
              <TableHead>End Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead className="text-right">Total Hrs</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Assigned</TableHead>
              {showActions && <TableHead className="pr-6 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-6"><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="ml-auto h-4 w-10" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                  {showActions && <TableCell className="pr-6"><Skeleton className="ml-auto size-8 rounded-md" /></TableCell>}
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-8 text-center text-sm text-muted-foreground">
                  Failed to load items.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-8 text-center text-sm text-muted-foreground">
                  No items yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="pl-6 text-sm font-medium">
                    {project.name}
                    {project.approval_status === "pending" && (
                      <Badge variant="outline" className="ml-2 border-amber-200 bg-amber-50 text-amber-700">
                        Pending Approval
                      </Badge>
                    )}
                    {project.approval_status === "rejected" && (
                      <Badge variant="outline" className="ml-2 border-rose-200 bg-rose-50 text-rose-700">
                        Rejected
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{ITEM_TYPE_LABEL[project.item_type]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{productNameById.get(project.product_id) ?? "—"}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(project.start_date)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {project.end_date ? formatDate(project.end_date) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{STATUS_LABEL[project.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={PRIORITY_BADGE_CLASS[project.priority]}>
                      {PRIORITY_LABEL[project.priority]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{project.total_working_hours}</TableCell>
                  <TableCell>
                    <ProgressBar percent={project.progress_percent} />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0 text-sm font-normal"
                      onClick={() => setViewingProject(project)}
                    >
                      {assignmentCounts[project.id] ?? 0} QA{(assignmentCounts[project.id] ?? 0) === 1 ? "" : "s"}
                    </Button>
                  </TableCell>
                  {showActions && (
                    <TableCell className="pr-6 text-right">
                      {canEdit && project.approval_status === "approved" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8" aria-label="Row actions">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditingProject(project)}>
                              <Pencil className="size-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => setDeletingProject(project)}
                              className="text-rose-600 focus:text-rose-600"
                            >
                              <Trash2 className="size-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {canPropose && project.approval_status === "pending" && project.proposed_by === currentProfileId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={withdrawMutation.isPending}
                          onClick={() => withdrawMutation.mutate(project.id)}
                        >
                          <Undo2 className="size-4" />
                          Withdraw
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      {editingProject && (
        <ProjectFormDialog
          key={editingProject.id}
          mode="edit"
          open
          onOpenChange={(o) => {
            if (!o) setEditingProject(null);
          }}
          initialValue={editingProject}
        />
      )}

      {viewingProject && (
        <ProjectAssignmentsDialog
          key={viewingProject.id}
          project={viewingProject}
          open
          onOpenChange={(o) => {
            if (!o) setViewingProject(null);
          }}
        />
      )}

      <AlertDialog
        open={deletingProject !== null}
        onOpenChange={(o) => {
          if (!o) setDeletingProject(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete item?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes &ldquo;{deletingProject?.name}&rdquo; and all of its allocations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deletingProject) deleteMutation.mutate(deletingProject.id);
              }}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
```

- [ ] **Step 5: Replace `src/components/projects/projects-page-content.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { ProjectTable } from "@/components/projects/project-table";
import { ProposeProjectDialog } from "@/components/projects/propose-project-dialog";
import { getApprovedAllocationCountsByProject } from "@/features/allocation-action";
import { getProducts } from "@/features/product-action";
import { getProjects } from "@/features/project-action";
import type { ProjectStatus } from "@/lib/project";
import type { ProfileRole } from "@/lib/profile";

export function ProjectsPageContent({ role, currentProfileId }: { role: ProfileRole; currentProfileId: string }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "">("");
  const [productFilter, setProductFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["projects", { search, status: statusFilter, product_id: productFilter }],
    queryFn: () => getProjects({ search, status: statusFilter, product_id: productFilter }),
  });

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });
  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));

  const { data: assignmentCounts } = useQuery({
    queryKey: ["allocation-counts", "approved"],
    queryFn: () => getApprovedAllocationCountsByProject(),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Project Portfolio</h1>
          <p className="text-sm text-muted-foreground">
            Manage and track projects, support testing, problem incidents, and service requests.
          </p>
        </div>
        {role === "qa_lead" && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New Item
          </Button>
        )}
        {role === "project_manager" && (
          <Button onClick={() => setProposeOpen(true)}>
            <Plus className="size-4" />
            Propose Item
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="max-w-64" />
        <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : (v as ProjectStatus))}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="to_do">To Do</SelectItem>
            <SelectItem value="ready_sit">Ready to SIT</SelectItem>
            <SelectItem value="sit">SIT</SelectItem>
            <SelectItem value="ready_uat">Ready to UAT</SelectItem>
            <SelectItem value="uat">UAT</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={productFilter || "all"} onValueChange={(v) => setProductFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Product" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Products</SelectItem>
            {(products ?? []).map((product) => (
              <SelectItem key={product.id} value={product.id}>
                {product.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ProjectTable
        rows={data ?? []}
        isLoading={isLoading}
        isError={isError}
        role={role}
        currentProfileId={currentProfileId}
        productNameById={productNameById}
        assignmentCounts={assignmentCounts ?? {}}
      />

      {role === "qa_lead" && <ProjectFormDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />}
      {role === "project_manager" && <ProposeProjectDialog open={proposeOpen} onOpenChange={setProposeOpen} />}
    </div>
  );
}
```

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors in `src/components/projects/*`.

Run: `npx eslint src/components/projects`
Expected: zero errors/warnings.

- [ ] **Step 7: Manual smoke check**

As QA Lead: "New Item" dialog's Product select is populated from the seeded Products (not hardcoded); submitting is blocked until a product is picked. Existing v1/v2 projects still show their correct product badge in the table. Click a row's "Assigned" count — confirm the dialog lists the right QAs with role/hours/priority/timeline/status. A project with zero assignments shows "0 QAs" and an empty-state message in the dialog. Product filter dropdown lists the seeded products and filters correctly. As Project Manager, "Propose Item" shows the same dynamic Product select.

- [ ] **Step 8: Commit**

```bash
git add src/components/projects
git commit -m "feat: source Product dynamically; add Assigned QAs view to Project Portfolio"
```

---

### Task 10: Dashboard action — date-range planning period

**Files:**
- Modify: `src/features/dashboard-action.ts`

**Interfaces:**
- Consumes: `weeksBetween` (v2 `@/lib/load`), `monthlyHoursForUser`/`monthlyHoursForProject` (v1 `@/lib/load`, imported under range-appropriate local names — their day-prorated math is already range-generic, nothing month-specific about the implementation).
- Produces: `getRangeDashboard(startDateISO, endDateISO): Promise<WeeklyDashboard>` — same `WeeklyDashboard` shape as `getWeeklyDashboard`, `allocatedHours` averaged over the range's week count instead of summed over one fixed week. Consumed by Task 12 (Allocation Tool UI).

- [ ] **Step 1: Replace `src/features/dashboard-action.ts`**

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import {
  isoWeekRange,
  monthRange,
  weeklyHoursForUser,
  weeklyLoadPercent,
  monthlyHoursForUser,
  monthlyHoursForProject,
  monthlyHoursForUser as rangeHoursForUser,
  monthlyHoursForProject as rangeHoursForProject,
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
    .select("user_id, project_id, hours_per_week, start_date, end_date")
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
  allocatedHours: number;
  loadPercent: number;
};

export type WeeklyDashboard = {
  totalCapacity: number;
  totalAllocated: number;
  availableCapacity: number;
  resourceLoad: ResourceLoadRow[];
  topDemand: { project: Project; hours: number }[];
};

export async function getWeeklyDashboard(weekStartISO: string): Promise<WeeklyDashboard> {
  const week = isoWeekRange(new Date(`${weekStartISO}T00:00:00Z`));
  const [resources, allocations] = await Promise.all([
    getActiveResources(),
    getApprovedAllocationsInRange(week.start, week.end),
  ]);

  const resourceLoad: ResourceLoadRow[] = resources.map((profile) => {
    const allocatedHours = weeklyHoursForUser(allocations, profile.id, week);
    return {
      profile,
      allocatedHours,
      loadPercent: weeklyLoadPercent(allocatedHours, profile.capacity_hours),
    };
  });

  const totalCapacity = resources.reduce((sum, p) => sum + p.capacity_hours, 0);
  const totalAllocated = resourceLoad.reduce((sum, r) => sum + r.allocatedHours, 0);

  const hoursByProject = new Map<string, number>();
  for (const allocation of allocations) {
    hoursByProject.set(allocation.project_id, (hoursByProject.get(allocation.project_id) ?? 0) + allocation.hours_per_week);
  }

  const projectIds = [...hoursByProject.keys()];
  const projects = await getProjectsByIds(projectIds);

  const topDemand = projects
    .map((project) => ({ project, hours: hoursByProject.get(project.id) ?? 0 }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5);

  return {
    totalCapacity,
    totalAllocated,
    availableCapacity: totalCapacity - totalAllocated,
    resourceLoad,
    topDemand,
  };
}

/**
 * Same shape as `getWeeklyDashboard`, but for an arbitrary [start, end] range
 * instead of one fixed ISO week — `allocatedHours` per QA (and `hours` per
 * project in `topDemand`) is the range's total prorated hours divided by
 * how many weeks the range spans, i.e. an average hrs/week figure, so the
 * existing 80%/100% load thresholds and hrs/wk-labeled UI keep meaning
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
    const allocatedHours = rangeHoursForUser(allocations, profile.id, range) / weeks;
    return {
      profile,
      allocatedHours,
      loadPercent: weeklyLoadPercent(allocatedHours, profile.capacity_hours),
    };
  });

  const totalCapacity = resources.reduce((sum, p) => sum + p.capacity_hours, 0);
  const totalAllocated = resourceLoad.reduce((sum, r) => sum + r.allocatedHours, 0);

  const projectIds = [...new Set(allocations.map((a) => a.project_id))];
  const projects = await getProjectsByIds(projectIds);

  const topDemand = projects
    .map((project) => ({ project, hours: rangeHoursForProject(allocations, project.id, range) / weeks }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5);

  return {
    totalCapacity,
    totalAllocated,
    availableCapacity: totalCapacity - totalAllocated,
    resourceLoad,
    topDemand,
  };
}

export type MonthlyMemberRow = { profile: Profile; hours: number };
export type MonthlyProjectRow = { project: Project; hours: number };

export async function getMonthlyDashboard(
  year: number,
  monthIndex0: number,
): Promise<{ perMember: MonthlyMemberRow[]; perProject: MonthlyProjectRow[] }> {
  const month = monthRange(year, monthIndex0);
  const [resources, allocations] = await Promise.all([
    getActiveResources(),
    getApprovedAllocationsInRange(month.start, month.end),
  ]);

  const perMember = resources
    .map((profile) => ({ profile, hours: monthlyHoursForUser(allocations, profile.id, month) }))
    .sort((a, b) => b.hours - a.hours);

  const projectIds = [...new Set(allocations.map((a) => a.project_id))];
  const projects = await getProjectsByIds(projectIds);

  const perProject = projects
    .map((project) => ({ project, hours: monthlyHoursForProject(allocations, project.id, month) }))
    .sort((a, b) => b.hours - a.hours);

  return { perMember, perProject };
}
```

Note: `monthlyHoursForUser`/`monthlyHoursForProject` are imported twice under two names (once as themselves for `getMonthlyDashboard`, once aliased as `rangeHoursForUser`/`rangeHoursForProject` for `getRangeDashboard`) — this is the same function reused for two conceptually different callers, not two implementations to keep in sync.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: `src/features/dashboard-action.ts` has zero errors; it was already clean before this task (no `Product`/`QaGroup` references), so the error count is unchanged from Task 9.

- [ ] **Step 3: Commit**

```bash
git add src/features/dashboard-action.ts
git commit -m "feat: add getRangeDashboard for the Allocation Tool's date-range planning period"
```

---

### Task 11: Dashboard UI — dynamic QA Groups, QA count column

**Files:**
- Modify: `src/components/dashboard/dashboard-page-content.tsx`

**Interfaces:**
- Consumes: `getQaGroups` (Task 4), `Profile.qa_group_id` (Task 2).
- Produces: nothing consumed elsewhere (leaf feature).

- [ ] **Step 1: Replace `src/components/dashboard/dashboard-page-content.tsx`**

Same file as the current version (which already has the "Capacity by QA Group" table from a prior change) with `QA_GROUP_LABEL`/`QA_GROUP_ORDER` removed in favor of `getQaGroups()`, grouping done by `qa_group_id`, and a new "# QAs" column:

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadBar } from "@/components/ui/load-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getMonthlyDashboard, getWeeklyDashboard } from "@/features/dashboard-action";
import { getProducts } from "@/features/product-action";
import { getQaGroups } from "@/features/qa-group-action";
import { isoWeekRange } from "@/lib/load";

function mondayOf(date: Date): string {
  return isoWeekRange(date).start;
}

export function DashboardPageContent() {
  const today = new Date();
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [year, setYear] = useState(today.getUTCFullYear());
  const [monthIndex0, setMonthIndex0] = useState(today.getUTCMonth());

  const { data: weekly, isLoading: weeklyLoading } = useQuery({
    queryKey: ["weekly-dashboard", weekStart],
    queryFn: () => getWeeklyDashboard(weekStart),
  });

  const { data: monthly, isLoading: monthlyLoading } = useQuery({
    queryKey: ["monthly-dashboard", year, monthIndex0],
    queryFn: () => getMonthlyDashboard(year, monthIndex0),
  });

  const { data: qaGroups } = useQuery({
    queryKey: ["qa-groups"],
    queryFn: () => getQaGroups(),
  });

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });
  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));

  const monthValue = `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;

  const resourceLoad = weekly?.resourceLoad ?? [];
  const allocatedPercent =
    weekly && weekly.totalCapacity > 0 ? (weekly.totalAllocated / weekly.totalCapacity) * 100 : 0;
  const avgAvailablePercent =
    resourceLoad.length > 0
      ? resourceLoad.reduce((sum, r) => sum + (100 - r.loadPercent), 0) / resourceLoad.length
      : 0;

  const groupStats = (qaGroups ?? []).map((group) => {
    const members = resourceLoad.filter((r) => r.profile.qa_group_id === group.id);
    const totalCapacity = members.reduce((sum, r) => sum + r.profile.capacity_hours, 0);
    const totalAllocated = members.reduce((sum, r) => sum + r.allocatedHours, 0);
    const avgAvailable =
      members.length > 0 ? members.reduce((sum, r) => sum + (100 - r.loadPercent), 0) / members.length : 0;
    return {
      groupId: group.id,
      groupName: group.name,
      memberCount: members.length,
      totalCapacity,
      totalAllocated,
      availableCapacity: totalCapacity - totalAllocated,
      avgAvailable,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Resource Dashboard</h1>
          <p className="text-sm text-muted-foreground">High-level overview of QA capacity and project demand.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="week-picker" className="text-xs text-muted-foreground">
            Week of
          </Label>
          <Input
            id="week-picker"
            type="date"
            value={weekStart}
            onChange={(e) => setWeekStart(mondayOf(new Date(`${e.target.value}T00:00:00Z`)))}
            className="w-40"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="space-y-1 pt-6">
            <p className="text-xs font-medium uppercase text-muted-foreground">Total QA Capacity</p>
            <p className="text-3xl font-bold tabular-nums">
              {weekly?.totalCapacity ?? 0} <span className="text-sm font-normal text-muted-foreground">hrs/wk</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-xs font-medium uppercase text-muted-foreground">Total Allocated</p>
            <p className="text-3xl font-bold tabular-nums">
              {weekly?.totalAllocated ?? 0} <span className="text-sm font-normal text-muted-foreground">hrs/wk</span>
            </p>
            <LoadBar percent={allocatedPercent} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-6">
            <p className="text-xs font-medium uppercase text-muted-foreground">Available Capacity</p>
            <p className="text-3xl font-bold tabular-nums">
              {weekly?.availableCapacity ?? 0} <span className="text-sm font-normal text-muted-foreground">hrs/wk</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-6">
            <p className="text-xs font-medium uppercase text-muted-foreground">Avg Available Capacity</p>
            <p className="text-3xl font-bold tabular-nums">
              {Math.round(avgAvailablePercent)} <span className="text-sm font-normal text-muted-foreground">%</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="px-0 pt-6">
          <h2 className="mb-4 px-6 text-lg font-semibold">Capacity by QA Group</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">QA Group</TableHead>
                <TableHead className="text-right"># QAs</TableHead>
                <TableHead className="text-right">Total Capacity</TableHead>
                <TableHead className="text-right">Total Allocated</TableHead>
                <TableHead className="text-right">Available Capacity</TableHead>
                <TableHead className="pr-6 text-right">Avg Available Capacity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {weeklyLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : (
                groupStats.map((stat) => (
                  <TableRow key={stat.groupId}>
                    <TableCell className="pl-6 text-sm font-medium">{stat.groupName}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{stat.memberCount}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {stat.totalCapacity} <span className="text-muted-foreground">hrs/wk</span>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {stat.totalAllocated} <span className="text-muted-foreground">hrs/wk</span>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {stat.availableCapacity} <span className="text-muted-foreground">hrs/wk</span>
                    </TableCell>
                    <TableCell className="pr-6 text-right text-sm tabular-nums">
                      {Math.round(stat.avgAvailable)}%
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-4 text-lg font-semibold">Resource Load</h2>
            {weeklyLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="space-y-3">
                {resourceLoad.map((row) => (
                  <div key={row.profile.id} className="flex items-center gap-3">
                    <span className="w-32 truncate text-sm font-medium">{row.profile.name}</span>
                    <span className="w-24 text-xs text-muted-foreground">
                      {row.allocatedHours}/{row.profile.capacity_hours} hrs
                    </span>
                    <LoadBar percent={row.loadPercent} className="flex-1" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-4 text-lg font-semibold">Top Product Demand</h2>
            {weeklyLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (weekly?.topDemand.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No allocated projects this week.</p>
            ) : (
              <div className="space-y-3">
                {weekly!.topDemand.map(({ project, hours }) => (
                  <div key={project.id} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{project.name}</span>
                    <span className="text-muted-foreground tabular-nums">{hours} hrs</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-1">
        <Label htmlFor="month-picker" className="text-xs text-muted-foreground">
          Month
        </Label>
        <Input
          id="month-picker"
          type="month"
          value={monthValue}
          onChange={(e) => {
            const [y, m] = e.target.value.split("-").map(Number);
            setYear(y);
            setMonthIndex0(m - 1);
          }}
          className="w-40"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-4 text-lg font-semibold">Monthly Hours per QA Member</h2>
            {monthlyLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="space-y-2">
                {(monthly?.perMember ?? []).map(({ profile, hours }) => (
                  <div key={profile.id} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{profile.name}</span>
                    <span className="text-muted-foreground tabular-nums">{Math.round(hours)} hrs</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-4 text-lg font-semibold">Monthly Demand per Project</h2>
            {monthlyLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="space-y-2">
                {(monthly?.perProject ?? []).map(({ project, hours }) => (
                  <div key={project.id} className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      {project.name}{" "}
                      <span className="text-muted-foreground">({productNameById.get(project.product_id) ?? "—"})</span>
                    </span>
                    <span className="text-muted-foreground tabular-nums">{Math.round(hours)} hrs</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: zero errors in `src/components/dashboard/*`.

Run: `npx eslint src/components/dashboard`
Expected: zero errors/warnings.

- [ ] **Step 3: Manual smoke check**

Open `/dashboard`. Confirm "Capacity by QA Group" now shows a "# QAs" column with correct counts per group, and "Monthly Demand per Project" still resolves each project's product name correctly (now via the dynamic lookup instead of the old hardcoded map).

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/dashboard-page-content.tsx
git commit -m "feat: source QA Group breakdown dynamically; add QA count column"
```

---

### Task 12: Allocation Tool UI — date-range planning period, grouped QA list

**Files:**
- Modify: `src/components/allocations/allocations-page-content.tsx`

**Interfaces:**
- Consumes: `getRangeDashboard` (Task 10), `getQaGroups` (Task 4), `ResourceLoadRow` (v1 `@/features/dashboard-action`), `Profile.qa_group_id` (Task 2).
- Produces: nothing consumed elsewhere (leaf feature). `AllocationForm` (v2) and `AssignmentsTable` (v2) are unchanged — they only read the already-computed `allocatedHours`/`capacityHours` figures, agnostic to whether those came from a week or a range.

- [ ] **Step 1: Replace `src/components/allocations/allocations-page-content.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LoadBar } from "@/components/ui/load-bar";
import { AllocationForm } from "@/components/allocations/allocation-form";
import { AssignmentsTable } from "@/components/allocations/assignments-table";
import { BulkAssignDialog } from "@/components/allocations/bulk-assign-dialog";
import { getRangeDashboard, type ResourceLoadRow } from "@/features/dashboard-action";
import { getProjects } from "@/features/project-action";
import { getQaGroups } from "@/features/qa-group-action";
import { isoWeekRange } from "@/lib/load";
import type { ProfileRole } from "@/lib/profile";

function mondayOf(date: Date): string {
  return isoWeekRange(date).start;
}

function sundayOf(date: Date): string {
  return isoWeekRange(date).end;
}

export function AllocationsPageContent({ role, currentProfileId }: { role: ProfileRole; currentProfileId: string }) {
  const [rangeStart, setRangeStart] = useState(() => mondayOf(new Date()));
  const [rangeEnd, setRangeEnd] = useState(() => sundayOf(new Date()));
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);

  const canWrite = role === "qa_lead" || role === "project_manager";
  const validRange = rangeStart <= rangeEnd;

  const { data: dashboard, isLoading: loadLoading } = useQuery({
    queryKey: ["range-dashboard", rangeStart, rangeEnd],
    queryFn: () => getRangeDashboard(rangeStart, rangeEnd),
    enabled: validRange,
  });

  const { data: qaGroups } = useQuery({
    queryKey: ["qa-groups"],
    queryFn: () => getQaGroups(),
  });

  // Fetch all projects (not just approved) so pending-project-proposal
  // allocations can still resolve a project name in the assignments table;
  // the pickers below filter back down to approved-only themselves.
  const { data: allProjects } = useQuery({
    queryKey: ["projects", {}],
    queryFn: () => getProjects(),
  });
  const approvedProjects = (allProjects ?? []).filter((p) => p.approval_status === "approved");

  const resources = dashboard?.resourceLoad ?? [];
  const filteredResources = useMemo(
    () => resources.filter((r) => r.profile.name.toLowerCase().includes(search.trim().toLowerCase())),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on dashboard (stable query cache reference), not the derived `resources` array literal
    [dashboard, search],
  );

  const groupedResources = useMemo(() => {
    const groups = (qaGroups ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      members: filteredResources.filter((r) => r.profile.qa_group_id === group.id),
    }));
    const unassigned = filteredResources.filter((r) => r.profile.qa_group_id === null);
    return unassigned.length > 0 ? [...groups, { id: "unassigned", name: "Unassigned", members: unassigned }] : groups;
  }, [qaGroups, filteredResources]);

  const selected = resources.find((r) => r.profile.id === selectedUserId) ?? null;

  function renderResourceButton(r: ResourceLoadRow) {
    return (
      <button
        key={r.profile.id}
        type="button"
        onClick={() => setSelectedUserId(r.profile.id)}
        className={`w-full rounded-md border p-3 text-left transition-colors ${
          selectedUserId === r.profile.id ? "border-blue-600 bg-blue-50" : "border-border hover:bg-muted"
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{r.profile.name}</span>
          <span className="text-xs text-muted-foreground">
            {Math.round(r.allocatedHours * 10) / 10}/{r.profile.capacity_hours} hrs
          </span>
        </div>
        <LoadBar percent={r.loadPercent} className="mt-2" />
      </button>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Allocation Tool</h1>
          <p className="text-sm text-muted-foreground">Assign QA resources to approved projects and manage capacity.</p>
        </div>
        {canWrite && (
          <Button onClick={() => setBulkAssignOpen(true)}>
            <Plus className="size-4" />
            Add Project
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="range-start" className="text-sm text-muted-foreground">
            Planning period — Start
          </label>
          <Input
            id="range-start"
            type="date"
            value={rangeStart}
            onChange={(e) => setRangeStart(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="range-end" className="text-sm text-muted-foreground">
            End
          </label>
          <Input
            id="range-end"
            type="date"
            value={rangeEnd}
            onChange={(e) => setRangeEnd(e.target.value)}
            className="w-40"
          />
        </div>
        {!validRange && <p className="text-sm text-rose-600">End date must be on or after start date.</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <h2 className="text-lg font-semibold">Select Resource</h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search QA members..."
                className="pl-9"
              />
            </div>
            <div className="space-y-4">
              {loadLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : filteredResources.length === 0 ? (
                <p className="text-sm text-muted-foreground">No resources found.</p>
              ) : (
                groupedResources
                  .filter((group) => group.members.length > 0)
                  .map((group) => (
                    <div key={group.id} className="space-y-2">
                      <h3 className="text-xs font-medium uppercase text-muted-foreground">{group.name}</h3>
                      <div className="space-y-2">{group.members.map(renderResourceButton)}</div>
                    </div>
                  ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <h2 className="text-lg font-semibold">Allocation Details</h2>
            {!selected ? (
              <p className="text-sm text-muted-foreground">Select a resource to assign work.</p>
            ) : canWrite ? (
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
            )}
          </CardContent>
        </Card>
      </div>

      {selected && (
        <AssignmentsTable
          userId={selected.profile.id}
          userName={selected.profile.name}
          projects={allProjects ?? []}
          role={role}
          currentProfileId={currentProfileId}
        />
      )}

      {canWrite && <BulkAssignDialog role={role} open={bulkAssignOpen} onOpenChange={setBulkAssignOpen} />}
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: zero errors project-wide (this resolves the last outstanding v3 errors).

Run: `npx eslint src/components/allocations`
Expected: zero errors/warnings.

- [ ] **Step 3: Manual smoke check**

`npm run dev`. Confirm "Planning week of" is now two date fields ("Start"/"End") defaulting to the current Mon–Sun week. Confirm the "Select Resource" list is sectioned by QA Group (with an "Unassigned" section if any active QA has no group), and search still filters within/across sections. Widen the range to a full month — confirm each QA's hrs/week figure now reads as a plausible average (not a raw weekly sum) and LoadBars still color correctly at the 80%/100% thresholds. Set End before Start — confirm the inline validation message appears and no request fires (no loading spinner stuck, no crash). Assign a resource within a range — confirm `AllocationForm`/`AssignmentsTable` still work exactly as before (they don't know or care that the source figure is now range-averaged).

- [ ] **Step 4: Commit**

```bash
git add src/components/allocations/allocations-page-content.tsx
git commit -m "feat: switch Allocation Tool to a date-range planning period, group QA list by QA Group"
```

---

### Task 13: End-to-end manual verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Apply the migration**

Open the Supabase Dashboard SQL editor and run `supabase/migrations/0003_qa_resource_manager_v3.sql` (Task 1) in full. Confirm no errors, `qa_groups` has 5 rows, `products` has 6 rows, existing profiles/projects kept their correct group/product after the cutover, and `profiles.qa_group`/`projects.product` no longer exist.

- [ ] **Step 2: Full type-check, lint, and build pass**

Run: `npx tsc --noEmit` — zero errors.
Run: `npx eslint .` — zero errors/warnings.
Run: `npm run build` — production build succeeds.

- [ ] **Step 3: QA Groups & Products CRUD (spec §3)**

As QA Lead on `/settings`: add, rename, and delete a QA Group and a Product; confirm the delete guard blocks removal of any group/product still in use, with an accurate count in the error message. Confirm both cards' lists match Team Management's QA Group dropdown and Project Portfolio's Product dropdown/filter/badges immediately (no stale cache) after adding a new one.

- [ ] **Step 4: Project assignments view (spec §1)**

On Project Portfolio, confirm every row shows an "Assigned" count for all three roles (QA Lead, QA Member, Project Manager), and clicking it opens the read-only dialog with the correct QA names, roles, hours, priorities, timelines, and status badges — including a project with zero assignments showing "0 QAs" and the dialog's empty state.

- [ ] **Step 5: Date-range planning period (spec §2)**

On Allocation Tool, confirm the default range is the current week, average hrs/week figures match hand-calculated expectations for a multi-week range, and invalid ranges (End before Start) are caught inline without firing a request. Confirm the Dashboard page's own "Week of" picker is untouched.

- [ ] **Step 6: Grouped QA list (spec §4)**

On Allocation Tool, confirm QA members are sectioned by QA Group with correct membership, an "Unassigned" section appears only when relevant, and search correctly narrows within and across sections (hiding empty ones).

- [ ] **Step 7: Dashboard QA count column (spec §5)**

On the Dashboard's "Capacity by QA Group" table, confirm the new "# QAs" column matches the actual number of active QAs in each group for the selected week.

- [ ] **Step 8: Regression pass on v1/v2 flows**

Confirm nothing broke: Team Management create/edit/deactivate/reset-password, Project Portfolio create/propose/approve/reject/complete (including the v2 auto-complete allocation-release cascade), Allocation Tool single-QA assign and bulk even-split assign, rebaseline (both QA-Lead-immediate and PM-staged), Approvals page (all three sections), Settings' Max Parallel Projects limit enforcement, and the Workload Distribution Report's monthly per-member/per-project tables.

- [ ] **Step 9: Fix any issues found**

If any step above fails, fix the underlying code (not the check), re-run `npx tsc --noEmit` and `npx eslint .`, and re-verify the specific failing step before moving on. Do not commit broken intermediate states — squash the fix into a new commit describing what was wrong.

---

## Self-Review

**Spec coverage** — every section of `docs/superpowers/specs/2026-08-10-qa-resource-manager-v3-design.md` maps to a task:
- §1 Project assigned-QAs view → Task 8 (`getAllocationsForProject`/`getApprovedAllocationCountsByProject`), Task 9 (`ProjectAssignmentsDialog`, Assigned column)
- §2 Date-range planning period → Task 10 (`getRangeDashboard`), Task 12 (UI)
- §3 QA Groups/Products CRUD → Task 1 (migration), Task 2 (types), Task 3 (schemas), Task 4 (actions), Task 5 (Settings UI), Task 6 (Team Management rollout), Task 7 (Project Portfolio server-side rollout), Task 9 (Project Portfolio UI rollout), Task 11 (Dashboard rollout)
- §4 Grouped QA list → Task 12
- §5 Dashboard QA count column → Task 11
- Out-of-scope items (nested groups, per-entity custom settings, bulk rename/merge, audit trail, changing the Dashboard's own week picker) are correctly not implemented anywhere above.

**Placeholder scan** — no "TBD"/"TODO"/"similar to Task N" patterns anywhere in Tasks 1–13; every code block is a full, runnable replacement or addition; every step names its exact verification command and expected result.

**Type consistency** — checked across tasks: `QaGroupRow`/`ProductRow` (Task 2) match `getQaGroups`/`getProducts`'s return types (Task 4) and every consumer (Tasks 5, 6, 9, 11, 12); `Profile.qa_group_id`/`Project.product_id` (Task 2) match `ProfileInput`/`ProjectInput` (Task 3), the action files (Tasks 6, 7), and every UI consumer; `NameEntityCard`'s generic prop shape (Task 5) matches both call sites' function signatures exactly (`getQaGroups`/`createQaGroup`/`updateQaGroup`/`deleteQaGroup` and the Product equivalents, Task 4); `getRangeDashboard` (Task 10) returns the same `WeeklyDashboard` type as `getWeeklyDashboard`, matching what Task 12's `allocations-page-content.tsx` already expects from the v1/v2 `getWeeklyDashboard` call it replaces; `getAllocationsForProject`/`getApprovedAllocationCountsByProject` (Task 8) match their usage in `ProjectAssignmentsDialog` and `ProjectTable`/`ProjectsPageContent` (Task 9); `ProjectTable`'s new `productNameById`/`assignmentCounts` props (Task 9) are populated and passed by `ProjectsPageContent` in the same task, no dangling prop.