# QA Group / Product / Lead Mappings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Settings designate one QA Lead per QA Group and one owning QA Group per Product, then use those mappings to pin/highlight each group's lead on the Dashboard and Allocation Tool, and to default a QA Lead's Project Portfolio view to their own group's projects.

**Architecture:** Two nullable FK columns (`qa_groups.lead_user_id`, `products.qa_group_id`) mirror the existing `profiles.qa_group_id` pattern — no join tables, since both relationships are one-owner. Two new bespoke Settings cards replace the shared name-only `NameEntityCard`. Dashboard and Allocation Tool reuse their existing per-group member lists, just sorting the lead first and badging them. Project Portfolio gains a new "QA Group" filter that composes with the existing Product filter and defaults to the logged-in QA Lead's own group.

**Tech Stack:** Next.js App Router, Supabase (`@supabase/ssr`, `@supabase/supabase-js`), TanStack React Query v5, Zod, shadcn/ui, TypeScript.

## Global Constraints

- Both new relationships are one-owner (a group has exactly one lead; a product has exactly one owning group) — no join tables, plain nullable FK columns.
- The lead picker (`getQaLeadCandidates`) lists only active profiles with role `qa_lead` or `head_of_qa` — this is a different role set from the existing `getAssignableProfiles()` (`qa_lead`/`qa_member`), so it's a new action, not a reuse.
- The "Lead" badge/highlight uses violet (`border-violet-200`/`bg-violet-50`/`text-violet-700`) — every other semantic color in this app is already claimed (amber=pending, emerald=approved, rose=rejected, blue=pending change), and "Lead" is not a status.
- The Project Portfolio default filter applies only to role `qa_lead` — `head_of_qa` always starts unfiltered, per explicit product decision.
- No automated test suite exists in this repo. Verification is `npx tsc --noEmit` after every task, plus a full manual pass in the final task.

---

### Task 1: Migration

**Files:**
- Create: `supabase/migrations/0009_qa_group_product_leads.sql`

- [ ] **Step 1: Write the migration**

```sql
alter table public.qa_groups add column lead_user_id uuid references public.profiles(id);
alter table public.products add column qa_group_id uuid references public.qa_groups(id);

create index qa_groups_lead_user_id_idx on public.qa_groups (lead_user_id);
create index products_qa_group_id_idx on public.products (qa_group_id);
```

- [ ] **Step 2: Apply the migration**

Run it against the Supabase project the same way migration `0008` was applied (this repo's Supabase project isn't CLI-linked here — apply via the Supabase SQL Editor, or your linked CLI if you have one). Confirm with `select lead_user_id from qa_groups limit 1;` and `select qa_group_id from products limit 1;` in the SQL editor.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0009_qa_group_product_leads.sql
git commit -m "feat: add qa_groups.lead_user_id and products.qa_group_id"
```

---

### Task 2: Types

**Files:**
- Modify: `src/lib/qa-group.ts`
- Modify: `src/lib/product.ts`

- [ ] **Step 1: `QaGroupRow`**

```ts
export type QaGroupRow = {
  id: string;
  name: string;
  lead_user_id: string | null;
};
```

- [ ] **Step 2: `ProductRow`**

```ts
export type ProductRow = {
  id: string;
  name: string;
  qa_group_id: string | null;
};
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: errors in files that construct/consume these types without the new field yet — fine, later tasks fix them.

- [ ] **Step 4: Commit**

```bash
git add src/lib/qa-group.ts src/lib/product.ts
git commit -m "feat: add lead_user_id/qa_group_id to QaGroupRow and ProductRow"
```

---

### Task 3: Schemas

**Files:**
- Modify: `src/features/qa-group-schema.ts`
- Modify: `src/features/product-schema.ts`

- [ ] **Step 1: `QaGroupInput`**

```ts
import { z } from "zod";

export const QaGroupInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  lead_user_id: z.string().uuid().nullable(),
});
export type QaGroupInput = z.infer<typeof QaGroupInput>;
```

- [ ] **Step 2: `ProductInput`**

```ts
import { z } from "zod";

export const ProductInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  qa_group_id: z.string().uuid().nullable(),
});
export type ProductInput = z.infer<typeof ProductInput>;
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/features/qa-group-schema.ts src/features/product-schema.ts
git commit -m "feat: add lead_user_id/qa_group_id to QA group and product schemas"
```

---

### Task 4: `qa-group-action.ts`

**Files:**
- Modify: `src/features/qa-group-action.ts`

**Interfaces:**
- Consumes: `QaGroupInput` (Task 3).
- Produces: `getQaGroups()` returns `lead_user_id`; `createQaGroup`/`updateQaGroup` persist it; `deleteQaGroup` also blocks while a product still references the group.

- [ ] **Step 1: `getQaGroups`**

```ts
export async function getQaGroups(): Promise<QaGroupRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("qa_groups")
    .select("id, name, lead_user_id")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as QaGroupRow[];
}
```

- [ ] **Step 2: `createQaGroup`**

Replace the insert call:

```ts
  const admin = createAdminClient();
  const { error } = await admin
    .from("qa_groups")
    .insert({ name: parsed.data.name, lead_user_id: parsed.data.lead_user_id });
  if (error) throw friendlyError(error);
  return { success: true };
```

- [ ] **Step 3: `updateQaGroup`**

Replace the update call:

```ts
  const admin = createAdminClient();
  const { error } = await admin
    .from("qa_groups")
    .update({ name: parsed.data.name, lead_user_id: parsed.data.lead_user_id })
    .eq("id", id);
  if (error) throw friendlyError(error);
  return { success: true };
```

- [ ] **Step 4: `deleteQaGroup` — add the product guard**

Insert a second guard after the existing "QAs still in this group" check:

```ts
  const { count, error: countError } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("qa_group_id", id);
  if (countError) throw new Error(countError.message);
  if (count && count > 0) {
    throw new Error(`Can't delete: ${count} QA(s) are still in this group`);
  }

  const { count: productCount, error: productCountError } = await admin
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("qa_group_id", id);
  if (productCountError) throw new Error(productCountError.message);
  if (productCount && productCount > 0) {
    throw new Error(`Can't delete: ${productCount} product(s) still assigned to this group`);
  }
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from `qa-group-action.ts` itself.

- [ ] **Step 6: Commit**

```bash
git add src/features/qa-group-action.ts
git commit -m "feat: persist QA group lead and block deletion while a product still uses it"
```

---

### Task 5: `product-action.ts`

**Files:**
- Modify: `src/features/product-action.ts`

**Interfaces:**
- Consumes: `ProductInput` (Task 3).
- Produces: `getProducts()` returns `qa_group_id`; `createProduct`/`updateProduct` persist it.

- [ ] **Step 1: `getProducts`**

```ts
export async function getProducts(): Promise<ProductRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, qa_group_id")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductRow[];
}
```

- [ ] **Step 2: `createProduct`**

Replace the insert call:

```ts
  const admin = createAdminClient();
  const { error } = await admin
    .from("products")
    .insert({ name: parsed.data.name, qa_group_id: parsed.data.qa_group_id });
  if (error) throw friendlyError(error);
  return { success: true };
```

- [ ] **Step 3: `updateProduct`**

Replace the update call:

```ts
  const admin = createAdminClient();
  const { error } = await admin
    .from("products")
    .update({ name: parsed.data.name, qa_group_id: parsed.data.qa_group_id })
    .eq("id", id);
  if (error) throw friendlyError(error);
  return { success: true };
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from `product-action.ts` itself.

- [ ] **Step 5: Commit**

```bash
git add src/features/product-action.ts
git commit -m "feat: persist a product's owning QA group"
```

---

### Task 6: `profile-action.ts` — `getQaLeadCandidates`

**Files:**
- Modify: `src/features/profile-action.ts`

**Interfaces:**
- Produces: `getQaLeadCandidates(): Promise<Profile[]>`. Consumed by Task 8's QA Group card.

- [ ] **Step 1: Add the function**

Add after `getAssignableProfiles`:

```ts
export async function getQaLeadCandidates(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_active", true)
    .in("role", QA_LEAD_ROLES)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}
```

(`createClient` and `QA_LEAD_ROLES` are both already imported in this file.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/features/profile-action.ts
git commit -m "feat: add getQaLeadCandidates for the QA group lead picker"
```

---

### Task 7: `project-action.ts` — QA Group filter

**Files:**
- Modify: `src/features/project-action.ts`

**Interfaces:**
- Produces: `getProjects(...)` gains an optional `qa_group_id` param that composes with the existing `product_id` filter. Consumed by Task 11.

- [ ] **Step 1: Rewrite `getProjects`**

Replace the whole function:

```ts
export async function getProjects({
  status = "",
  product_id = "",
  qa_group_id = "",
  search = "",
  item_type = "",
  priority = "",
  approvalStatus,
}: {
  status?: ProjectStatus | "";
  product_id?: string;
  qa_group_id?: string;
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

  let projectIdFilter: string[] | null = null;

  if (product_id) {
    const { data: matches, error: matchError } = await supabase
      .from("project_products")
      .select("project_id")
      .eq("product_id", product_id);
    if (matchError) throw new Error(matchError.message);
    projectIdFilter = [...new Set((matches ?? []).map((m) => m.project_id))];
    if (projectIdFilter.length === 0) return [];
  }

  if (qa_group_id) {
    const { data: groupProducts, error: gpError } = await supabase
      .from("products")
      .select("id")
      .eq("qa_group_id", qa_group_id);
    if (gpError) throw new Error(gpError.message);
    const productIds = (groupProducts ?? []).map((p) => p.id);
    if (productIds.length === 0) return [];

    const { data: matches, error: matchError } = await supabase
      .from("project_products")
      .select("project_id")
      .in("product_id", productIds);
    if (matchError) throw new Error(matchError.message);
    const groupProjectIds = new Set((matches ?? []).map((m) => m.project_id));

    projectIdFilter = projectIdFilter
      ? projectIdFilter.filter((id) => groupProjectIds.has(id))
      : [...groupProjectIds];
    if (projectIdFilter.length === 0) return [];
  }

  if (projectIdFilter) query = query.in("id", projectIdFilter);

  const { data, error } = await query.order("start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const { project_products, ...project } = row as Project & { project_products: { product_id: string }[] };
    return { ...project, product_ids: project_products.map((pp) => pp.product_id) };
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from `project-action.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add src/features/project-action.ts
git commit -m "feat: add composable qa_group_id filter to getProjects"
```

---

### Task 8: Settings UI — bespoke QA Group and Product cards

**Files:**
- Create: `src/components/settings/qa-group-card.tsx`
- Create: `src/components/settings/product-card.tsx`
- Modify: `src/components/settings/settings-page-content.tsx`
- Delete: `src/components/settings/name-entity-card.tsx`

**Interfaces:**
- Consumes: `getQaLeadCandidates` (Task 6), `getQaGroups`/`createQaGroup`/`updateQaGroup`/`deleteQaGroup` (Task 4), `getProducts`/`createProduct`/`updateProduct`/`deleteProduct` (Task 5).
- Produces: `QaGroupCard`, `ProductCard` — no props, each self-contained (mirrors how `NameEntityCard` was used: mounted directly with no props beyond what's now hardcoded per-entity).

- [ ] **Step 1: Create `QaGroupCard`**

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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createQaGroup, deleteQaGroup, getQaGroups, updateQaGroup } from "@/features/qa-group-action";
import { getQaLeadCandidates } from "@/features/profile-action";
import type { QaGroupRow } from "@/lib/qa-group";

const NONE = "none";

export function QaGroupCard() {
  const [addOpen, setAddOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<QaGroupRow | null>(null);
  const [deletingItem, setDeletingItem] = useState<QaGroupRow | null>(null);
  const [name, setName] = useState("");
  const [leadUserId, setLeadUserId] = useState(NONE);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["qa-groups"],
    queryFn: () => getQaGroups(),
  });

  const { data: leadCandidates } = useQuery({
    queryKey: ["qa-lead-candidates"],
    queryFn: () => getQaLeadCandidates(),
  });
  const leadNameById = new Map((leadCandidates ?? []).map((p) => [p.id, p.name]));

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["qa-groups"] });
  }

  const createMutation = useMutation({
    mutationFn: () => createQaGroup({ name, lead_user_id: leadUserId === NONE ? null : leadUserId }),
    onSuccess: () => {
      toast.success("QA Group added");
      invalidate();
      setName("");
      setLeadUserId(NONE);
      setAddOpen(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateQaGroup(editingItem!.id, { name, lead_user_id: leadUserId === NONE ? null : leadUserId }),
    onSuccess: () => {
      toast.success("QA Group updated");
      invalidate();
      setEditingItem(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteQaGroup(id),
    onSuccess: () => {
      toast.success("QA Group deleted");
      invalidate();
      setDeletingItem(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function openAdd() {
    setName("");
    setLeadUserId(NONE);
    setAddOpen(true);
  }

  function openEdit(item: QaGroupRow) {
    setName(item.name);
    setLeadUserId(item.lead_user_id ?? NONE);
    setEditingItem(item);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>QA Groups</CardTitle>
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
              <TableHead>Lead</TableHead>
              <TableHead className="pr-6 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : !data || data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                  No QA groups yet.
                </TableCell>
              </TableRow>
            ) : (
              data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="pl-6 text-sm font-medium">{item.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.lead_user_id ? (leadNameById.get(item.lead_user_id) ?? "—") : "—"}
                  </TableCell>
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
            <DialogTitle>Add QA Group</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              createMutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="qa-group-add-name">Name</Label>
              <Input id="qa-group-add-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qa-group-add-lead">Lead</Label>
              <Select value={leadUserId} onValueChange={setLeadUserId}>
                <SelectTrigger id="qa-group-add-lead" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No lead assigned</SelectItem>
                  {(leadCandidates ?? []).map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <DialogTitle>Edit QA Group</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              updateMutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="qa-group-edit-name">Name</Label>
              <Input id="qa-group-edit-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qa-group-edit-lead">Lead</Label>
              <Select value={leadUserId} onValueChange={setLeadUserId}>
                <SelectTrigger id="qa-group-edit-lead" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No lead assigned</SelectItem>
                  {(leadCandidates ?? []).map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <AlertDialogTitle>Delete QA group?</AlertDialogTitle>
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

- [ ] **Step 2: Create `ProductCard`**

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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createProduct, deleteProduct, getProducts, updateProduct } from "@/features/product-action";
import { getQaGroups } from "@/features/qa-group-action";
import type { ProductRow } from "@/lib/product";

const NONE = "none";

export function ProductCard() {
  const [addOpen, setAddOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ProductRow | null>(null);
  const [deletingItem, setDeletingItem] = useState<ProductRow | null>(null);
  const [name, setName] = useState("");
  const [qaGroupId, setQaGroupId] = useState(NONE);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });

  const { data: qaGroups } = useQuery({
    queryKey: ["qa-groups"],
    queryFn: () => getQaGroups(),
  });
  const groupNameById = new Map((qaGroups ?? []).map((g) => [g.id, g.name]));

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  const createMutation = useMutation({
    mutationFn: () => createProduct({ name, qa_group_id: qaGroupId === NONE ? null : qaGroupId }),
    onSuccess: () => {
      toast.success("Product added");
      invalidate();
      setName("");
      setQaGroupId(NONE);
      setAddOpen(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateProduct(editingItem!.id, { name, qa_group_id: qaGroupId === NONE ? null : qaGroupId }),
    onSuccess: () => {
      toast.success("Product updated");
      invalidate();
      setEditingItem(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProduct(id),
    onSuccess: () => {
      toast.success("Product deleted");
      invalidate();
      setDeletingItem(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function openAdd() {
    setName("");
    setQaGroupId(NONE);
    setAddOpen(true);
  }

  function openEdit(item: ProductRow) {
    setName(item.name);
    setQaGroupId(item.qa_group_id ?? NONE);
    setEditingItem(item);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Products</CardTitle>
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
              <TableHead>QA Group</TableHead>
              <TableHead className="pr-6 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : !data || data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                  No products yet.
                </TableCell>
              </TableRow>
            ) : (
              data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="pl-6 text-sm font-medium">{item.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.qa_group_id ? (groupNameById.get(item.qa_group_id) ?? "—") : "—"}
                  </TableCell>
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
            <DialogTitle>Add Product</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              createMutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="product-add-name">Name</Label>
              <Input id="product-add-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-add-group">QA Group</Label>
              <Select value={qaGroupId} onValueChange={setQaGroupId}>
                <SelectTrigger id="product-add-group" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No group assigned</SelectItem>
                  {(qaGroups ?? []).map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <DialogTitle>Edit Product</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              updateMutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="product-edit-name">Name</Label>
              <Input id="product-edit-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-edit-group">QA Group</Label>
              <Select value={qaGroupId} onValueChange={setQaGroupId}>
                <SelectTrigger id="product-edit-group" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No group assigned</SelectItem>
                  {(qaGroups ?? []).map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
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

- [ ] **Step 3: Wire both into `settings-page-content.tsx`, remove `NameEntityCard`**

Replace:

```tsx
import { NameEntityCard } from "@/components/settings/name-entity-card";
import { getSettings, updateSettings } from "@/features/settings-action";
import { createProduct, deleteProduct, getProducts, updateProduct } from "@/features/product-action";
import { createQaGroup, deleteQaGroup, getQaGroups, updateQaGroup } from "@/features/qa-group-action";
```

with:

```tsx
import { ProductCard } from "@/components/settings/product-card";
import { QaGroupCard } from "@/components/settings/qa-group-card";
import { getSettings, updateSettings } from "@/features/settings-action";
```

Replace:

```tsx
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
```

with:

```tsx
      <QaGroupCard />

      <ProductCard />
```

- [ ] **Step 4: Delete the now-dead `NameEntityCard`**

```bash
git rm src/components/settings/name-entity-card.tsx
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/qa-group-card.tsx src/components/settings/product-card.tsx src/components/settings/settings-page-content.tsx
git commit -m "feat: add QA Group lead and Product QA Group pickers to Settings"
```

---

### Task 9: Dashboard — highlight each group's lead

**Files:**
- Modify: `src/components/dashboard/dashboard-page-content.tsx`

**Interfaces:**
- Consumes: `QaGroupRow.lead_user_id` (Task 2, already flowing through the existing `getQaGroups()` query in this file).

- [ ] **Step 1: Add the `Badge` import**

```tsx
import { Badge } from "@/components/ui/badge";
```

- [ ] **Step 2: Sort each group's members, lead first, and carry `leadUserId` through**

Replace:

```tsx
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
    const avgAvailable =
      unassignedMembers.reduce((sum, r) => sum + (100 - r.loadPercent), 0) / unassignedMembers.length;
    groupSections.push({
      id: "unassigned",
      name: "Unassigned",
      members: unassignedMembers,
      totalCapacity,
      totalAllocated,
      avgAvailable,
    });
  }
```

with:

```tsx
  const groupSections = (qaGroups ?? []).map((group) => {
    const members = [...resourceLoad.filter((r) => r.profile.qa_group_id === group.id)].sort(
      (a, b) => Number(b.profile.id === group.lead_user_id) - Number(a.profile.id === group.lead_user_id),
    );
    const totalCapacity = members.reduce((sum, r) => sum + r.profile.capacity_days, 0);
    const totalAllocated = members.reduce((sum, r) => sum + r.allocatedDays, 0);
    const avgAvailable =
      members.length > 0 ? members.reduce((sum, r) => sum + (100 - r.loadPercent), 0) / members.length : 0;
    return {
      id: group.id,
      name: group.name,
      leadUserId: group.lead_user_id,
      members,
      totalCapacity,
      totalAllocated,
      avgAvailable,
    };
  });
  const unassignedMembers = resourceLoad.filter((r) => r.profile.qa_group_id === null);
  if (unassignedMembers.length > 0) {
    const totalCapacity = unassignedMembers.reduce((sum, r) => sum + r.profile.capacity_days, 0);
    const totalAllocated = unassignedMembers.reduce((sum, r) => sum + r.allocatedDays, 0);
    const avgAvailable =
      unassignedMembers.reduce((sum, r) => sum + (100 - r.loadPercent), 0) / unassignedMembers.length;
    groupSections.push({
      id: "unassigned",
      name: "Unassigned",
      leadUserId: null,
      members: unassignedMembers,
      totalCapacity,
      totalAllocated,
      avgAvailable,
    });
  }
```

- [ ] **Step 3: Badge + highlight the lead's row**

Replace:

```tsx
                    {group.members.map((row) => (
                      <div key={row.profile.id} className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setSelectedQa({ id: row.profile.id, name: row.profile.name })}
                          className="w-32 truncate text-left text-sm font-medium hover:underline"
                        >
                          {row.profile.name}
                        </button>
                        <span className="w-24 text-xs text-muted-foreground">
                          {roundHalf(row.allocatedDays)}/{row.profile.capacity_days} days
                        </span>
                        <LoadBar percent={row.loadPercent} className="flex-1" />
                      </div>
                    ))}
```

with:

```tsx
                    {group.members.map((row) => {
                      const isLead = row.profile.id === group.leadUserId;
                      return (
                        <div
                          key={row.profile.id}
                          className={`flex items-center gap-3 rounded-md ${isLead ? "bg-violet-50 px-2 py-1" : ""}`}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedQa({ id: row.profile.id, name: row.profile.name })}
                            className="w-32 truncate text-left text-sm font-medium hover:underline"
                          >
                            {row.profile.name}
                          </button>
                          {isLead && (
                            <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                              Lead
                            </Badge>
                          )}
                          <span className="w-24 text-xs text-muted-foreground">
                            {roundHalf(row.allocatedDays)}/{row.profile.capacity_days} days
                          </span>
                          <LoadBar percent={row.loadPercent} className="flex-1" />
                        </div>
                      );
                    })}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/dashboard-page-content.tsx
git commit -m "feat: pin and badge each QA group's lead on the Dashboard"
```

---

### Task 10: Allocation Tool — highlight each group's lead

**Files:**
- Modify: `src/components/allocations/allocations-page-content.tsx`

**Interfaces:**
- Consumes: `QaGroupRow.lead_user_id` (Task 2, already flowing through the existing `getQaGroups()` query in this file).

- [ ] **Step 1: Add the `Badge` import**

```tsx
import { Badge } from "@/components/ui/badge";
```

- [ ] **Step 2: Sort each group's members, lead first, and carry `leadUserId` through**

Replace:

```tsx
  const groupedResources = useMemo(() => {
    const groups = (qaGroups ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      members: filteredResources.filter((r) => r.profile.qa_group_id === group.id),
    }));
    const unassigned = filteredResources.filter((r) => r.profile.qa_group_id === null);
    return unassigned.length > 0 ? [...groups, { id: "unassigned", name: "Unassigned", members: unassigned }] : groups;
  }, [qaGroups, filteredResources]);
```

with:

```tsx
  const groupedResources = useMemo(() => {
    const groups = (qaGroups ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      leadUserId: group.lead_user_id,
      members: [...filteredResources.filter((r) => r.profile.qa_group_id === group.id)].sort(
        (a, b) => Number(b.profile.id === group.lead_user_id) - Number(a.profile.id === group.lead_user_id),
      ),
    }));
    const unassigned = filteredResources.filter((r) => r.profile.qa_group_id === null);
    return unassigned.length > 0
      ? [...groups, { id: "unassigned", name: "Unassigned", leadUserId: null, members: unassigned }]
      : groups;
  }, [qaGroups, filteredResources]);
```

- [ ] **Step 3: Badge + highlight the lead in `renderResourceButton`**

Replace:

```tsx
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
            {Math.round(r.allocatedDays * 2) / 2}/{r.profile.capacity_days} days
          </span>
        </div>
        <LoadBar percent={r.loadPercent} className="mt-2" />
      </button>
    );
  }
```

with:

```tsx
  function renderResourceButton(r: ResourceLoadRow, leadUserId: string | null) {
    const isLead = r.profile.id === leadUserId;
    return (
      <button
        key={r.profile.id}
        type="button"
        onClick={() => setSelectedUserId(r.profile.id)}
        className={`w-full rounded-md border p-3 text-left transition-colors ${
          selectedUserId === r.profile.id
            ? "border-blue-600 bg-blue-50"
            : isLead
              ? "border-violet-200 bg-violet-50 hover:bg-violet-100"
              : "border-border hover:bg-muted"
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-medium">
            {r.profile.name}
            {isLead && (
              <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                Lead
              </Badge>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            {Math.round(r.allocatedDays * 2) / 2}/{r.profile.capacity_days} days
          </span>
        </div>
        <LoadBar percent={r.loadPercent} className="mt-2" />
      </button>
    );
  }
```

- [ ] **Step 4: Update the call site**

Replace `<div className="space-y-2">{group.members.map(renderResourceButton)}</div>` with:

```tsx
                      <div className="space-y-2">
                        {group.members.map((r) => renderResourceButton(r, group.leadUserId))}
                      </div>
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/components/allocations/allocations-page-content.tsx
git commit -m "feat: pin and badge each QA group's lead on the Allocation Tool"
```

---

### Task 11: Project Portfolio — QA Group filter with a QA Lead default

**Files:**
- Modify: `src/app/(app)/projects/page.tsx`
- Modify: `src/components/projects/projects-page-content.tsx`

**Interfaces:**
- Consumes: `getProjects({ ..., qa_group_id })` (Task 7), `getQaGroups()` (existing action, now returning `lead_user_id` but unused here).

- [ ] **Step 1: Pass the profile's `qa_group_id` down**

In `src/app/(app)/projects/page.tsx`, replace:

```tsx
export default async function ProjectsPage() {
  const profile = await getCurrentProfile();
  return <ProjectsPageContent role={profile!.role} currentProfileId={profile!.id} />;
}
```

with:

```tsx
export default async function ProjectsPage() {
  const profile = await getCurrentProfile();
  return (
    <ProjectsPageContent
      role={profile!.role}
      currentProfileId={profile!.id}
      qaGroupId={profile!.qa_group_id}
    />
  );
}
```

- [ ] **Step 2: Accept the new prop and add the `getQaGroups` import**

In `src/components/projects/projects-page-content.tsx`, replace:

```tsx
import { getApprovedAllocationCountsByProject } from "@/features/allocation-action";
import { getProducts } from "@/features/product-action";
import { getProjects } from "@/features/project-action";
import type { ItemType, Priority, ProjectStatus } from "@/lib/project";
import { QA_LEAD_ROLES, type ProfileRole } from "@/lib/profile";
```

with:

```tsx
import { getApprovedAllocationCountsByProject } from "@/features/allocation-action";
import { getProducts } from "@/features/product-action";
import { getProjects } from "@/features/project-action";
import { getQaGroups } from "@/features/qa-group-action";
import type { ItemType, Priority, ProjectStatus } from "@/lib/project";
import { QA_LEAD_ROLES, type ProfileRole } from "@/lib/profile";
```

Replace the component signature and initial filter state:

```tsx
export function ProjectsPageContent({ role, currentProfileId }: { role: ProfileRole; currentProfileId: string }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "">("");
  const [productFilter, setProductFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<ItemType | "">("");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "">("");
```

with:

```tsx
export function ProjectsPageContent({
  role,
  currentProfileId,
  qaGroupId,
}: {
  role: ProfileRole;
  currentProfileId: string;
  qaGroupId: string | null;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "">("");
  const [productFilter, setProductFilter] = useState("");
  const [qaGroupFilter, setQaGroupFilter] = useState(() => (role === "qa_lead" ? (qaGroupId ?? "") : ""));
  const [typeFilter, setTypeFilter] = useState<ItemType | "">("");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "">("");
```

- [ ] **Step 3: Thread the filter into the query, and add the `qaGroups` query**

Replace:

```tsx
  const { data, isLoading, isError } = useQuery({
    queryKey: [
      "projects",
      { search, status: statusFilter, product_id: productFilter, item_type: typeFilter, priority: priorityFilter },
    ],
    queryFn: () =>
      getProjects({
        search,
        status: statusFilter,
        product_id: productFilter,
        item_type: typeFilter,
        priority: priorityFilter,
      }),
  });

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });
  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));
```

with:

```tsx
  const { data, isLoading, isError } = useQuery({
    queryKey: [
      "projects",
      {
        search,
        status: statusFilter,
        product_id: productFilter,
        qa_group_id: qaGroupFilter,
        item_type: typeFilter,
        priority: priorityFilter,
      },
    ],
    queryFn: () =>
      getProjects({
        search,
        status: statusFilter,
        product_id: productFilter,
        qa_group_id: qaGroupFilter,
        item_type: typeFilter,
        priority: priorityFilter,
      }),
  });

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });
  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));

  const { data: qaGroups } = useQuery({
    queryKey: ["qa-groups"],
    queryFn: () => getQaGroups(),
  });
```

- [ ] **Step 4: Add the "QA Group" filter control**

Insert right after the existing Product `<Select>` block, before the Type filter:

```tsx
        <Select
          value={productFilter || "all"}
          onValueChange={(v) => {
            setProductFilter(v === "all" ? "" : v);
            setPage(1);
          }}
        >
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
        <Select
          value={qaGroupFilter || "all"}
          onValueChange={(v) => {
            setQaGroupFilter(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="QA Group" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All QA Groups</SelectItem>
            {(qaGroups ?? []).map((group) => (
              <SelectItem key={group.id} value={group.id}>
                {group.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/projects/page.tsx" src/components/projects/projects-page-content.tsx
git commit -m "feat: default a QA Lead's Project Portfolio view to their own QA Group"
```

---

### Task 12: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Manual QA pass**

Run the dev server, sign in as a QA Lead, and check:

1. **Settings**: QA Groups card shows a "Lead" column with a working picker (including "No lead assigned"); Products card shows a "QA Group" column with a working picker (including "No group assigned"). Assign a lead to a group and a group to a product; confirm both persist after a page reload.
2. **Delete guard**: try deleting a QA Group that still owns a product — confirm it's blocked with `"Can't delete: N product(s) still assigned to this group"`.
3. **Dashboard**: on "Capacity by QA Group", confirm the group's designated lead appears first in their group's member list with a violet "Lead" badge, and everyone else's relative order is unchanged.
4. **Allocation Tool**: on "Select Resource", confirm the same lead is pinned first in their group with the same badge and a violet-tinted card (when not the currently-selected resource).
5. **Project Portfolio as `qa_lead`**: sign in as a QA Lead whose profile has a `qa_group_id` set to a group that owns at least one product. Confirm the page loads with the "QA Group" filter pre-set to their group and the table narrowed accordingly. Confirm you can clear it back to "All QA Groups".
6. **Project Portfolio as `head_of_qa`**: confirm the page loads unfiltered (QA Group filter on "All QA Groups") even if that account happens to be set as some group's lead.
7. **QA Group filter composes with Product filter**: pick a QA Group, then also pick a specific product owned by a *different* group — confirm the table narrows to zero (the two filters intersect, they don't override each other).

- [ ] **Step 3: Report results**

If every check in Step 2 passes, this feature is complete. If anything fails, stop and report exactly which check failed and what was observed — do not attempt a fix without diagnosing the root cause first (see `superpowers:systematic-debugging`).
