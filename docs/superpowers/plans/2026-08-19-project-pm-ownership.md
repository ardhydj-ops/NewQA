# Project PM Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every project can carry a Project Manager owner (`pm_id`), auto-set when a PM submits a proposal, assignable/reassignable by Head of QA, QA Lead, or any PM via a new "PM Name" column on the Project Portfolio table. PM logins default-sort their own projects first. The Propose Item dialog drops its "Tester Assignments" section entirely.

**Architecture:** New nullable `projects.pm_id` column (FK to `profiles`). `proposeProject` sets it to the submitting PM. A new `assignProjectPm` action lets privileged roles set/clear it on any project. A new `getProjectManagers()` helper feeds the assignment dropdown. `project-table.tsx` gains a "PM Name" column (dropdown for QA Lead/Head of QA/PM, plain text for QA Member) and a new `"pm"` sort key. `projects-page-content.tsx` defaults the initial sort to `"pm"` for PM logins.

**Tech Stack:** Supabase (admin client for the write), Zod, TanStack Query, existing shadcn/ui `Select`/`SortableHeader` patterns — no new UI primitives.

## Global Constraints

- No automated test suite exists in this repo — verification is `npx tsc --noEmit` + `npx eslint` plus manual QA, per established project convention.
- `pm_id` is distinct from `proposed_by` — never conflate them; `proposed_by` is untouched by this plan.
- Projects created via "New Item" (QA Lead) or the Excel import leave `pm_id` null — this plan does not add a PM field to those flows.
- Full design context: `docs/superpowers/specs/2026-08-19-project-pm-ownership-design.md`.

---

### Task 1: Schema, type, and server actions

**Files:**
- Create: `supabase/migrations/0011_project_pm_ownership.sql`
- Modify: `src/lib/project.ts`
- Modify: `src/features/project-schema.ts`
- Modify: `src/features/project-action.ts`
- Modify: `src/features/profile-action.ts`

**Interfaces:**
- Produces: `Project.pm_id: string | null`; `assignProjectPm(projectId: string, pmId: string | null): Promise<{ success: true }>`; `getProjectManagers(): Promise<Profile[]>`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0011_project_pm_ownership.sql`:

```sql
-- Distinct from proposed_by (who submitted the proposal — can be a QA
-- Lead via New Item or the Excel import, not always a PM). pm_id is the
-- project's PM owner: auto-set when a PM proposes, otherwise assignable
-- afterward by Head of QA, QA Lead, or any PM.
alter table projects
  add column pm_id uuid references profiles(id);
```

- [ ] **Step 2: Add the field to the Project type**

In `src/lib/project.ts`, add `pm_id: string | null;` to the `Project` type (next to `proposed_by` reads naturally, but exact position doesn't matter):

```ts
export type Project = {
  id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  product_ids: string[];
  status: ProjectStatus;
  progress_percent: number;
  item_type: ItemType;
  total_working_days: number;
  priority: Priority;
  jira_link: string;
  jiva_link: string;
  support_request_form_link: string | null;
  pm_id: string | null;
  approval_status: ApprovalStatus;
  proposed_by: string | null;
  proposed_start_date: string | null;
  proposed_end_date: string | null;
  proposed_total_working_days: number | null;
  proposed_priority: Priority | null;
  change_proposed_by: string | null;
  change_requested_at: string | null;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 3: Make `allocations` optional on the proposal schema**

In `src/features/project-schema.ts`, change:
```ts
export const ProjectProposalInput = z.object({
  project: ProjectProposalProjectInput,
  allocations: z.array(ProposedAllocationInput).min(1, "Add at least one tester assignment"),
});
```
to:
```ts
export const ProjectProposalInput = z.object({
  project: ProjectProposalProjectInput,
  allocations: z.array(ProposedAllocationInput).default([]),
});
```

- [ ] **Step 4: Set `pm_id` and guard the allocations insert in `proposeProject`**

In `src/features/project-action.ts`, in the `proposeProject` function's `projects` insert, add `pm_id: profile.id` next to `proposed_by: profile.id`:

```ts
      support_request_form_link: parsed.data.project.support_request_form_link ?? null,
      pm_id: profile.id,
      approval_status: "pending",
      proposed_by: profile.id,
```

Then change the unconditional allocations insert:
```ts
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

  return { success: true };
```
to:
```ts
  if (parsed.data.allocations.length > 0) {
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
  }

  return { success: true };
```

- [ ] **Step 5: Add `assignProjectPm`**

In `src/features/project-action.ts`, add near `deleteProject`:

```ts
export async function assignProjectPm(projectId: string, pmId: string | null): Promise<{ success: true }> {
  await requireRole([...QA_LEAD_ROLES, "project_manager"]);

  const admin = createAdminClient();
  const { error } = await admin.from("projects").update({ pm_id: pmId }).eq("id", projectId);
  if (error) throw new Error(error.message);
  return { success: true };
}
```

- [ ] **Step 6: Add `getProjectManagers`**

In `src/features/profile-action.ts`, add near `getQaLeadCandidates`:

```ts
export async function getProjectManagers(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_active", true)
    .eq("role", "project_manager")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}
```

- [ ] **Step 7: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/lib/project.ts src/features/project-schema.ts src/features/project-action.ts src/features/profile-action.ts`

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0011_project_pm_ownership.sql src/lib/project.ts src/features/project-schema.ts src/features/project-action.ts src/features/profile-action.ts
git commit -m "feat: add project PM ownership field and assignment action"
```

---

### Task 2: Remove Tester Assignments from Propose Item

**Files:**
- Modify: `src/components/projects/propose-project-dialog.tsx`

- [ ] **Step 1: Rewrite the file**

Replace the full contents of `src/components/projects/propose-project-dialog.tsx` with:

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
import { ProductMultiSelect } from "@/components/products/product-multi-select";
import { getProducts } from "@/features/product-action";
import { proposeProject } from "@/features/project-action";
import type { ItemType, Priority, ProjectStatus } from "@/lib/project";

type ProposeProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProposeProjectDialog({ open, onOpenChange }: ProposeProjectDialogProps) {
  const [name, setName] = useState("");
  const [itemType, setItemType] = useState<ItemType>("project");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [productIds, setProductIds] = useState<string[]>([]);
  const [status, setStatus] = useState<ProjectStatus>("to_do");
  const [priority, setPriority] = useState<Priority>("medium");
  const [jiraLink, setJiraLink] = useState("https://jpnqa.atlassian.net/jira");
  const [jivaLink, setJivaLink] = useState("https://jiva.jalin.co.id/");
  const [supportRequestFormLink, setSupportRequestFormLink] = useState("");
  const queryClient = useQueryClient();

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
          product_ids: productIds,
          status,
          progress_percent: 0,
          priority,
          jira_link: jiraLink,
          jiva_link: jivaLink,
          support_request_form_link: itemType === "support_testing" ? supportRequestFormLink : undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Proposal submitted — pending QA Lead approval");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setName("");
      setStartDate("");
      setEndDate("");
      setProductIds([]);
      setJiraLink("https://jpnqa.atlassian.net/jira");
      setJivaLink("https://jiva.jalin.co.id/");
      setSupportRequestFormLink("");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
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
              <Label htmlFor="proposal_product">Products</Label>
              <ProductMultiSelect products={products ?? []} selectedProductIds={productIds} onChange={setProductIds} />
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="proposal_jira">JIRA Link</Label>
              <Input
                id="proposal_jira"
                type="url"
                placeholder="https://..."
                value={jiraLink}
                onChange={(e) => setJiraLink(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal_jiva">Jiva Link</Label>
              <Input
                id="proposal_jiva"
                type="url"
                placeholder="https://..."
                value={jivaLink}
                onChange={(e) => setJivaLink(e.target.value)}
                required
              />
            </div>
          </div>

          {itemType === "support_testing" && (
            <div className="space-y-2">
              <Label htmlFor="proposal_support_form">Support Request Form (SharePoint Link)</Label>
              <Input
                id="proposal_support_form"
                type="url"
                placeholder="https://...sharepoint.com/..."
                value={supportRequestFormLink}
                onChange={(e) => setSupportRequestFormLink(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Upload the Support Request Form to SharePoint yourself, then paste the link here.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="submit"
              disabled={
                mutation.isPending ||
                productIds.length === 0 ||
                (itemType === "support_testing" && !supportRequestFormLink.trim())
              }
            >
              {mutation.isPending ? "Submitting..." : "Submit proposal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/components/projects/propose-project-dialog.tsx`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/projects/propose-project-dialog.tsx
git commit -m "feat: remove Tester Assignments from the Propose Item dialog"
```

---

### Task 3: "PM Name" column on the Project Portfolio table

**Files:**
- Modify: `src/components/projects/project-table.tsx`

**Interfaces:**
- Consumes: `assignProjectPm` from `@/features/project-action` (Task 1); `Profile` type from `@/lib/profile`.
- Produces: `ProjectTable` gains required props `pmNameById: Map<string, string>` and `projectManagers: Profile[]` (consumed by Task 4).

- [ ] **Step 1: Add imports**

Add to the `@/components/ui/select` import (new import block, since `project-table.tsx` doesn't currently import `Select`):
```ts
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
```

Add `assignProjectPm` to the existing `@/features/project-action` import:
```ts
import { assignProjectPm, deleteProject, withdrawProjectProposal } from "@/features/project-action";
```

Merge the `Profile` type into the existing `@/lib/profile` import line — change:
```ts
import { QA_LEAD_ROLES, type ProfileRole } from "@/lib/profile";
```
to:
```ts
import { QA_LEAD_ROLES, type Profile, type ProfileRole } from "@/lib/profile";
```

- [ ] **Step 2: Add the `"pm"` sort key**

Change:
```ts
export type ProjectSortKey =
  | "name"
  | "assigned"
  | "product"
  | "progress"
  | "start_date"
  | "end_date"
  | "total_days"
  | "type"
  | "status"
  | "priority";
```
to:
```ts
export type ProjectSortKey =
  | "name"
  | "pm"
  | "assigned"
  | "product"
  | "progress"
  | "start_date"
  | "end_date"
  | "total_days"
  | "type"
  | "status"
  | "priority";
```

- [ ] **Step 3: Add the new props**

Change:
```ts
type ProjectTableProps = {
  rows: Project[];
  isLoading: boolean;
  isError: boolean;
  role: ProfileRole;
  currentProfileId: string;
  productNameById: Map<string, string>;
  assignmentCounts: Record<string, number>;
  sortKey: ProjectSortKey;
  sortDirection: "asc" | "desc";
  onSortChange: (key: ProjectSortKey) => void;
  highlightedProjectId?: string | null;
};

export function ProjectTable({
  rows,
  isLoading,
  isError,
  role,
  currentProfileId,
  productNameById,
  assignmentCounts,
  sortKey,
  sortDirection,
  onSortChange,
  highlightedProjectId,
}: ProjectTableProps) {
```
to:
```ts
type ProjectTableProps = {
  rows: Project[];
  isLoading: boolean;
  isError: boolean;
  role: ProfileRole;
  currentProfileId: string;
  productNameById: Map<string, string>;
  pmNameById: Map<string, string>;
  projectManagers: Profile[];
  assignmentCounts: Record<string, number>;
  sortKey: ProjectSortKey;
  sortDirection: "asc" | "desc";
  onSortChange: (key: ProjectSortKey) => void;
  highlightedProjectId?: string | null;
};

export function ProjectTable({
  rows,
  isLoading,
  isError,
  role,
  currentProfileId,
  productNameById,
  pmNameById,
  projectManagers,
  assignmentCounts,
  sortKey,
  sortDirection,
  onSortChange,
  highlightedProjectId,
}: ProjectTableProps) {
```

- [ ] **Step 4: Add the assign-PM mutation and bump `columnCount`**

Change:
```ts
  const canEdit = QA_LEAD_ROLES.includes(role);
  const canPropose = role === "project_manager";
  const showActions = canEdit || canPropose;
  const columnCount = showActions ? 11 : 10;
```
to:
```ts
  const canEdit = QA_LEAD_ROLES.includes(role);
  const canPropose = role === "project_manager";
  const showActions = canEdit || canPropose;
  const columnCount = showActions ? 12 : 11;

  const assignPmMutation = useMutation({
    mutationFn: ({ projectId, pmId }: { projectId: string; pmId: string | null }) => assignProjectPm(projectId, pmId),
    onSuccess: () => {
      toast.success("PM updated");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
```

- [ ] **Step 5: Add the header**

Change:
```tsx
              <SortableHeader
                label="Name"
                sortKey="name"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={onSortChange}
                className="w-50 pl-6"
              />
              <SortableHeader label="Assigned" sortKey="assigned" activeKey={sortKey} direction={sortDirection} onSort={onSortChange} />
```
to:
```tsx
              <SortableHeader
                label="Name"
                sortKey="name"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={onSortChange}
                className="w-50 pl-6"
              />
              <SortableHeader label="PM Name" sortKey="pm" activeKey={sortKey} direction={sortDirection} onSort={onSortChange} />
              <SortableHeader label="Assigned" sortKey="assigned" activeKey={sortKey} direction={sortDirection} onSort={onSortChange} />
```

- [ ] **Step 6: Add a skeleton cell**

Change the loading skeleton row from:
```tsx
                <TableRow key={i}>
                  <TableCell className="pl-6"><Skeleton className="h-4 w-50" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-14" /></TableCell>
```
to:
```tsx
                <TableRow key={i}>
                  <TableCell className="pl-6"><Skeleton className="h-4 w-50" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-14" /></TableCell>
```

- [ ] **Step 7: Add the cell**

Change:
```tsx
                  <TableCell className="w-50 pl-6 text-sm font-medium whitespace-normal break-words">
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
                    {project.proposed_start_date !== null && (
                      <Badge variant="outline" className="ml-2 border-amber-200 bg-amber-50 text-amber-700">
                        Rebaseline Pending
                      </Badge>
                    )}
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
```
to:
```tsx
                  <TableCell className="w-50 pl-6 text-sm font-medium whitespace-normal break-words">
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
                    {project.proposed_start_date !== null && (
                      <Badge variant="outline" className="ml-2 border-amber-200 bg-amber-50 text-amber-700">
                        Rebaseline Pending
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {role === "qa_member" ? (
                      <span className="text-sm text-muted-foreground">
                        {project.pm_id ? (pmNameById.get(project.pm_id) ?? "—") : "—"}
                      </span>
                    ) : (
                      <Select
                        value={project.pm_id ?? "unassigned"}
                        onValueChange={(value) =>
                          assignPmMutation.mutate({ projectId: project.id, pmId: value === "unassigned" ? null : value })
                        }
                      >
                        <SelectTrigger className="h-8 w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {projectManagers.map((pm) => (
                            <SelectItem key={pm.id} value={pm.id}>
                              {pm.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
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
```

- [ ] **Step 8: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/components/projects/project-table.tsx`

Expected: errors referencing missing `pmNameById`/`projectManagers` props at the `<ProjectTable>` call site in `projects-page-content.tsx` — expected at this point, resolved in Task 4. No other errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/projects/project-table.tsx
git commit -m "feat: add PM Name column to the Project Portfolio table"
```

---

### Task 4: Wire PM data and role-based default sort

**Files:**
- Modify: `src/components/projects/projects-page-content.tsx`

- [ ] **Step 1: Add imports**

Add `getProfiles` and `getProjectManagers` to the profile-action import (new import line, since this file doesn't currently import from `@/features/profile-action`):
```ts
import { getProfiles, getProjectManagers } from "@/features/profile-action";
```

- [ ] **Step 2: Make the initial sort role-dependent**

Change:
```ts
  const [sortKey, setSortKey] = useState<ProjectSortKey>("assigned");
```
to:
```ts
  const [sortKey, setSortKey] = useState<ProjectSortKey>(() => (role === "project_manager" ? "pm" : "assigned"));
```

- [ ] **Step 3: Add the PM queries and name map**

Add near the existing `products`/`qaGroups` queries:
```ts
  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => getProfiles(),
  });
  const pmNameById = new Map((profiles ?? []).map((p) => [p.id, p.name]));

  const { data: projectManagers } = useQuery({
    queryKey: ["project-managers"],
    queryFn: () => getProjectManagers(),
  });
```

- [ ] **Step 4: Add the `"pm"` sort case**

Add a case to the `sortedRows` switch, right after the `"name"` case:
```ts
      case "name":
        return a.name.localeCompare(b.name) * direction;
      case "pm": {
        const aMine = a.pm_id === currentProfileId ? 0 : 1;
        const bMine = b.pm_id === currentProfileId ? 0 : 1;
        if (aMine !== bMine) return (aMine - bMine) * direction;
        const nameA = a.pm_id ? pmNameById.get(a.pm_id) : undefined;
        const nameB = b.pm_id ? pmNameById.get(b.pm_id) : undefined;
        if (!nameA && !nameB) return 0;
        if (!nameA) return 1;
        if (!nameB) return -1;
        return nameA.localeCompare(nameB) * direction;
      }
```

- [ ] **Step 5: Pass the new props to `ProjectTable`**

Change:
```tsx
      <ProjectTable
        rows={pagedRows}
        isLoading={isLoading}
        isError={isError}
        role={role}
        currentProfileId={currentProfileId}
        productNameById={productNameById}
        assignmentCounts={assignmentCounts ?? {}}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
        highlightedProjectId={highlightedProjectId}
      />
```
to:
```tsx
      <ProjectTable
        rows={pagedRows}
        isLoading={isLoading}
        isError={isError}
        role={role}
        currentProfileId={currentProfileId}
        productNameById={productNameById}
        pmNameById={pmNameById}
        projectManagers={projectManagers ?? []}
        assignmentCounts={assignmentCounts ?? {}}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
        highlightedProjectId={highlightedProjectId}
      />
```

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/components/projects/projects-page-content.tsx src/components/projects/project-table.tsx`

Expected: no errors (this resolves the expected Task 3 errors).

- [ ] **Step 7: Commit**

```bash
git add src/components/projects/projects-page-content.tsx
git commit -m "feat: default Project Portfolio sort to PM-first for PM logins"
```

---

### Task 5: Manual QA pass

**Files:** none (verification only)

- [ ] **Step 1: Apply the migration**

Apply `supabase/migrations/0011_project_pm_ownership.sql` manually via the Supabase SQL editor (this project isn't CLI-linked here).

- [ ] **Step 2: Propose Item has no Tester Assignments section**

As a PM, open Propose Item → confirm there's no "Tester Assignments" section at all → submit a proposal with just project details.

- [ ] **Step 3: PM auto-set on approval**

As Head of QA/QA Lead, approve that proposal → confirm the approved project's "PM Name" column shows the submitting PM's name.

- [ ] **Step 4: New Item leaves PM unassigned**

As QA Lead, create a project via "New Item" → confirm its "PM Name" shows "Unassigned".

- [ ] **Step 5: Assign and reassign**

As Head of QA, assign a PM to that unassigned project via the PM Name dropdown → confirm it updates immediately and persists on reload. As a *different* PM, reassign that same project to yourself → confirm it succeeds (no self-only restriction).

- [ ] **Step 6: PM-first default sort**

Log in as a PM with several of their own projects mixed among others' → confirm the table initially sorts their own projects first. Click a different column header → confirm normal sorting takes over. Reload the page → confirm it defaults back to PM-first sort.

- [ ] **Step 7: QA Member sees read-only text**

Confirm a QA Member sees the PM Name column as plain text, no dropdown.

- [ ] **Step 8: Excel import unaffected**

Confirm the Excel schedule-import flow (Import Schedule button) still works end-to-end and leaves `pm_id` null on anything it creates.

- [ ] **Step 9: Report results**

Note any failures back before considering this feature done — this task has no automated pass/fail, it's the actual acceptance check for the feature.
