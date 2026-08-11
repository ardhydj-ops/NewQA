# Project Rebaseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Project Manager propose a schedule/priority change (Start Date, End Date, Total Working Days, Priority) on an approved project, staged until a QA Lead approves or rejects it.

**Architecture:** Reuses the exact staging pattern already shipped for allocation rebaseline: new `proposed_*` + `change_proposed_by`/`change_requested_at` columns on `projects`, a PM-only `proposeProjectChange` action that stages them, and QA-Lead-only `approveProjectChange`/`rejectProjectChange` actions that apply-and-clear or clear-only. UI mirrors the existing `RebaselineDialog` (PM side) and the "Pending Allocation Changes" card (QA Lead side).

**Tech Stack:** Next.js App Router, Supabase (Postgres), TanStack Query 5, Zod 4, shadcn/ui, sonner. No test runner in this repo — verification is `tsc --noEmit` + `eslint` for every task, plus a manual/browser check at the end (this app's established practice; see `docs/superpowers/specs/2026-08-11-project-rebaseline-design.md`).

## Global Constraints

- Rebaseline fields are exactly: Start Date, End Date, Total Working Days, Priority. No other project field is part of this flow.
- Only `project_manager` may call `proposeProjectChange`; only `qa_lead` may call `approveProjectChange`/`rejectProjectChange`/`getPendingProjectChanges`. Use `requireRole` from `@/lib/auth` exactly as every other action in this codebase does.
- A project can have at most one pending change at a time — `proposeProjectChange` must throw if `proposed_start_date` is already non-null on that row.
- Total Working Days must stay a positive half-day multiple (`multipleOf(0.5)`), matching `ProjectInput` in `project-schema.ts`.
- No withdraw action for a PM's own pending change (matches the existing allocation rebaseline's limits — see spec's Out of Scope).
- **This repo has no linked Supabase CLI project and no direct Postgres connection string** — migrations in `supabase/migrations/` are applied by hand against the live project. Task 1 only creates the SQL file; a human partner must run it via the Supabase Studio SQL editor before Task 6's live verification will work. Every other task's code compiles and lints fine without the live columns existing yet.

---

### Task 1: Migration + `Project` type

**Files:**
- Create: `supabase/migrations/0006_project_rebaseline.sql`
- Modify: `src/lib/project.ts`

**Interfaces:**
- Produces: `Project` type gains `proposed_start_date: string | null`, `proposed_end_date: string | null`, `proposed_total_working_days: number | null`, `proposed_priority: Priority | null`, `change_proposed_by: string | null`, `change_requested_at: string | null`. Every later task relies on these exact field names.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/0006_project_rebaseline.sql
-- Project rebaseline: a PM proposes schedule/priority changes to an
-- approved project; the change is staged until a QA Lead approves or
-- rejects it. Mirrors allocations.proposed_* from migration 0002.

alter table public.projects
  add column if not exists proposed_start_date date,
  add column if not exists proposed_end_date date,
  add column if not exists proposed_total_working_days numeric,
  add column if not exists proposed_priority text check
    (proposed_priority is null or proposed_priority in ('low','medium','high','critical')),
  add column if not exists change_proposed_by uuid references public.profiles(id),
  add column if not exists change_requested_at timestamptz;

alter table public.projects drop constraint if exists projects_proposed_total_working_days_check;
alter table public.projects add constraint projects_proposed_total_working_days_check
  check (proposed_total_working_days is null or
    (proposed_total_working_days > 0 and proposed_total_working_days = round(proposed_total_working_days * 2) / 2));

create index if not exists projects_change_proposed_by_idx
  on public.projects (change_proposed_by) where change_proposed_by is not null;
```

- [ ] **Step 2: Add the fields to the `Project` type**

In `src/lib/project.ts`, add six fields to the `Project` type, right after `proposed_by`:

```ts
export type Project = {
  id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  product_id: string;
  status: ProjectStatus;
  progress_percent: number;
  item_type: ItemType;
  total_working_days: number;
  priority: Priority;
  jira_link: string;
  jiva_link: string;
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

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors (this is a pure type addition; nothing consumes the new fields yet).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0006_project_rebaseline.sql src/lib/project.ts
git commit -m "feat: add project rebaseline staging columns"
```

- [ ] **Step 5: Flag the migration for manual application**

Tell your human partner: "Migration `0006_project_rebaseline.sql` is written but not yet applied — please run it against the Supabase project's SQL editor before Task 6's live verification." Do not attempt to apply it yourself; there is no CLI linkage or connection string available in this repo. Continue to Task 2 regardless — the remaining tasks only need the type, not the live columns.

---

### Task 2: PM-side schema and server action

**Files:**
- Modify: `src/features/project-schema.ts`
- Modify: `src/features/project-action.ts`

**Interfaces:**
- Consumes: `Project` type from Task 1 (`proposed_start_date` etc.), `requireRole` from `@/lib/auth`, `createAdminClient` from `@/lib/supabase/admin` (both already imported in `project-action.ts`).
- Produces: `ProjectChangeInput` zod schema and type; `proposeProjectChange(id: string, input: unknown): Promise<{ success: true }>`. Task 4's dialog calls this exact function.

- [ ] **Step 1: Add `ProjectChangeInput` to `project-schema.ts`**

Add this at the end of `src/features/project-schema.ts` (the file already defines `isoDate` at the top — reuse it):

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

- [ ] **Step 2: Add `proposeProjectChange` to `project-action.ts`**

In `src/features/project-action.ts`, add `ProjectChangeInput` to the existing import from `@/features/project-schema` (currently `import { ProjectInput, ProjectProposalInput } from "@/features/project-schema";` — add it to that list), then add this function after `withdrawProjectProposal`:

```ts
/**
 * A Project Manager's request to change Start Date / End Date / Total
 * Working Days / Priority on an already-approved project. Stages into
 * `proposed_*` — never touches the live columns directly. Blocked while
 * another change is already pending on the same row. A QA Lead's own edit
 * instead goes through `updateProject` directly (immediate, no staging).
 */
export async function proposeProjectChange(id: string, input: unknown): Promise<{ success: true }> {
  const profile = await requireRole(["project_manager"]);

  const parsed = ProjectChangeInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("approval_status, proposed_start_date")
    .eq("id", id)
    .single();

  if (!project || project.approval_status !== "approved") {
    throw new Error("Only an approved item can be rebaselined");
  }
  if (project.proposed_start_date !== null) {
    throw new Error("This item already has a pending change awaiting approval");
  }

  const { error } = await admin
    .from("projects")
    .update({
      proposed_start_date: parsed.data.start_date,
      proposed_end_date: parsed.data.end_date,
      proposed_total_working_days: parsed.data.total_working_days,
      proposed_priority: parsed.data.priority,
      change_proposed_by: profile.id,
      change_requested_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return { success: true };
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/features/project-schema.ts src/features/project-action.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/project-schema.ts src/features/project-action.ts
git commit -m "feat: add proposeProjectChange server action"
```

---

### Task 3: QA Lead approval actions

**Files:**
- Modify: `src/features/approval-action.ts`

**Interfaces:**
- Consumes: `Project` type from Task 1. This file already imports `createAdminClient`, `requireRole`, and `type { Project } from "@/lib/project"`.
- Produces: `getPendingProjectChanges(): Promise<Project[]>`, `approveProjectChange(id: string): Promise<{ success: true }>`, `rejectProjectChange(id: string): Promise<{ success: true }>`. Task 5's Approvals page calls all three exactly as named.

- [ ] **Step 1: Add the three functions**

Add to the end of `src/features/approval-action.ts`:

```ts
export async function getPendingProjectChanges(): Promise<Project[]> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("projects")
    .select("*")
    .not("proposed_start_date", "is", null)
    .order("change_requested_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Project[];
}

export async function approveProjectChange(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();

  const { data: project, error: fetchError } = await admin
    .from("projects")
    .select("proposed_start_date, proposed_end_date, proposed_total_working_days, proposed_priority")
    .eq("id", id)
    .single();
  if (fetchError || !project || project.proposed_start_date === null) {
    throw new Error("This item has no pending change");
  }

  const { error } = await admin
    .from("projects")
    .update({
      start_date: project.proposed_start_date,
      end_date: project.proposed_end_date,
      total_working_days: project.proposed_total_working_days,
      priority: project.proposed_priority,
      proposed_start_date: null,
      proposed_end_date: null,
      proposed_total_working_days: null,
      proposed_priority: null,
      change_proposed_by: null,
      change_requested_at: null,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return { success: true };
}

export async function rejectProjectChange(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error } = await admin
    .from("projects")
    .update({
      proposed_start_date: null,
      proposed_end_date: null,
      proposed_total_working_days: null,
      proposed_priority: null,
      change_proposed_by: null,
      change_requested_at: null,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return { success: true };
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/features/approval-action.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/approval-action.ts
git commit -m "feat: add QA Lead approve/reject actions for project rebaseline"
```

---

### Task 4: PM-side dialog and table wiring

**Files:**
- Create: `src/components/projects/project-rebaseline-dialog.tsx`
- Modify: `src/components/projects/project-table.tsx`

**Interfaces:**
- Consumes: `proposeProjectChange` from Task 2 (`@/features/project-action`), `Project`/`Priority` types from Task 1.
- Produces: `ProjectRebaselineDialog` component with props `{ project: Project; open: boolean; onOpenChange: (open: boolean) => void }`.

- [ ] **Step 1: Create `project-rebaseline-dialog.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { proposeProjectChange } from "@/features/project-action";
import type { Priority, Project } from "@/lib/project";

type ProjectRebaselineDialogProps = {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProjectRebaselineDialog({ project, open, onOpenChange }: ProjectRebaselineDialogProps) {
  const [startDate, setStartDate] = useState(project.start_date);
  const [endDate, setEndDate] = useState(project.end_date ?? "");
  const [totalWorkingDays, setTotalWorkingDays] = useState(String(project.total_working_days));
  const [priority, setPriority] = useState<Priority>(project.priority);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      proposeProjectChange(project.id, {
        start_date: startDate,
        end_date: endDate,
        total_working_days: Number(totalWorkingDays),
        priority,
      }),
    onSuccess: () => {
      toast.success("Change proposed — pending QA Lead approval");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rebaseline item</DialogTitle>
          <DialogDescription>Changes here need QA Lead approval before they take effect.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rebaseline_project_start">Start Date</Label>
              <Input
                id="rebaseline_project_start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rebaseline_project_end">End Date</Label>
              <Input
                id="rebaseline_project_end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rebaseline_project_days">Total Working Days</Label>
            <Input
              id="rebaseline_project_days"
              type="number"
              min={0.5}
              step={0.5}
              value={totalWorkingDays}
              onChange={(e) => setTotalWorkingDays(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rebaseline_project_priority">Priority</Label>
            <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
              <SelectTrigger id="rebaseline_project_priority" className="w-full">
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
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Submitting..." : "Propose change"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire the button and badge into `project-table.tsx`**

Add the import (alongside the other dialog imports):

```ts
import { ProjectRebaselineDialog } from "@/components/projects/project-rebaseline-dialog";
```

Add `CalendarClock` to the existing `lucide-react` import list (currently `ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, MoreHorizontal, Pencil, Trash2, UserPlus, Undo2`):

```ts
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarClock,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Trash2,
  UserPlus,
  Undo2,
} from "lucide-react";
```

Add a new state hook next to `assigningProject`:

```ts
const [rebaseliningProject, setRebaseliningProject] = useState<Project | null>(null);
```

Add the badge — right after the existing `{project.approval_status === "rejected" && (...)}` block inside the Name `TableCell`:

```tsx
{project.proposed_start_date !== null && (
  <Badge variant="outline" className="ml-2 border-amber-200 bg-amber-50 text-amber-700">
    Rebaseline Pending
  </Badge>
)}
```

Add the action button — inside the Action cell's `<div className="flex justify-end gap-1">`, right after the existing "Assign QA" button block, gated to `canPropose` only (not `canEdit`, since a QA Lead already has direct edit access):

```tsx
{canPropose && project.approval_status === "approved" && (
  <Button
    variant="ghost"
    size="icon"
    className="size-8"
    onClick={() => setRebaseliningProject(project)}
    aria-label="Rebaseline"
  >
    <CalendarClock className="size-4" />
  </Button>
)}
```

Add the dialog render block, alongside the other conditional dialogs (after the `assigningProject` block):

```tsx
{rebaseliningProject && (
  <ProjectRebaselineDialog
    key={rebaseliningProject.id}
    project={rebaseliningProject}
    open
    onOpenChange={(o) => {
      if (!o) setRebaseliningProject(null);
    }}
  />
)}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/components/projects/project-rebaseline-dialog.tsx src/components/projects/project-table.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/projects/project-rebaseline-dialog.tsx src/components/projects/project-table.tsx
git commit -m "feat: add PM project rebaseline dialog and table action"
```

---

### Task 5: QA Lead approval UI

**Files:**
- Modify: `src/components/approvals/approvals-page-content.tsx`

**Interfaces:**
- Consumes: `getPendingProjectChanges`, `approveProjectChange`, `rejectProjectChange` from Task 3 (`@/features/approval-action`).

- [ ] **Step 1: Add the imports and query**

Add the three new functions to the existing import from `@/features/approval-action` (keep the list alphabetized, matching the file's current style):

```ts
import {
  approveAllocation,
  approveAllocationChange,
  approveProjectChange,
  approveProjectProposal,
  getPendingAllocationChanges,
  getPendingAllocationProposals,
  getPendingProjectChanges,
  getPendingProjectProposals,
  rejectAllocation,
  rejectAllocationChange,
  rejectProjectChange,
  rejectProjectProposal,
} from "@/features/approval-action";
```

Add the query, alongside the existing `allocationChanges` query:

```ts
const { data: projectChanges, isLoading: projectChangesLoading } = useQuery({
  queryKey: ["approvals", "project-changes"],
  queryFn: () => getPendingProjectChanges(),
});
```

- [ ] **Step 2: Add the mutations**

Add alongside the existing `approveChangeMutation`/`rejectChangeMutation`:

```ts
const approveProjectChangeMutation = useMutation({
  mutationFn: approveProjectChange,
  onSuccess: () => {
    toast.success("Rebaseline applied");
    invalidateAll();
  },
  onError: (error: Error) => toast.error(error.message),
});

const rejectProjectChangeMutation = useMutation({
  mutationFn: rejectProjectChange,
  onSuccess: () => {
    toast.success("Rebaseline rejected");
    invalidateAll();
  },
  onError: (error: Error) => toast.error(error.message),
});
```

- [ ] **Step 3: Add the "Pending Project Changes" card**

Add this card in the JSX, after the existing "Pending Allocation Changes" `</Card>` and before the closing `</div>` of the page:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Pending Project Changes</CardTitle>
  </CardHeader>
  <CardContent className="space-y-4">
    {projectChangesLoading ? (
      <p className="text-sm text-muted-foreground">Loading...</p>
    ) : !projectChanges || projectChanges.length === 0 ? (
      <p className="text-sm text-muted-foreground">No pending rebaseline requests.</p>
    ) : (
      projectChanges.map((project) => (
        <div key={project.id} className="rounded-md border p-4">
          <div className="flex items-start justify-between gap-4">
            <span className="font-medium">{project.name}</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={rejectProjectChangeMutation.isPending}
                onClick={() => rejectProjectChangeMutation.mutate(project.id)}
              >
                <X className="size-4" />
                Reject
              </Button>
              <Button
                size="sm"
                disabled={approveProjectChangeMutation.isPending}
                onClick={() => approveProjectChangeMutation.mutate(project.id)}
              >
                <Check className="size-4" />
                Approve
              </Button>
            </div>
          </div>

          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead />
                <TableHead className="text-right">Total Days</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Timeline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="text-sm text-muted-foreground">Current</TableCell>
                <TableCell className="text-right tabular-nums">{project.total_working_days}</TableCell>
                <TableCell>{project.priority}</TableCell>
                <TableCell>
                  {formatDate(project.start_date)} – {project.end_date ? formatDate(project.end_date) : "Ongoing"}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-sm font-medium">Proposed</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {project.proposed_total_working_days}
                </TableCell>
                <TableCell className="font-medium">{project.proposed_priority}</TableCell>
                <TableCell className="font-medium">
                  {project.proposed_start_date ? formatDate(project.proposed_start_date) : "—"} –{" "}
                  {project.proposed_end_date ? formatDate(project.proposed_end_date) : "Ongoing"}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      ))
    )}
  </CardContent>
</Card>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/components/approvals/approvals-page-content.tsx`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds (this is the last task touching every layer, so a full build is worth the extra confidence beyond `tsc`/`eslint`).

- [ ] **Step 5: Commit**

```bash
git add src/components/approvals/approvals-page-content.tsx
git commit -m "feat: add Pending Project Changes card to Approvals page"
```

---

### Task 6: Manual verification against live data

**Files:** none — this task is a verification checklist, no code changes.

**Interfaces:** none.

- [ ] **Step 1: Confirm the migration has been applied**

Ask your human partner to confirm migration `0006_project_rebaseline.sql` has been run against the live Supabase project (flagged at the end of Task 1). Do not proceed with live testing until confirmed.

- [ ] **Step 2: Browser walkthrough as PM**

Sign in as a `project_manager`, open the Project Portfolio page, find an approved project. Confirm the new "Rebaseline" (`CalendarClock`) button appears next to "Assign QA" in the Action column, and that a QA Lead's own view does *not* show this button (only "Assign QA" and the Edit/Delete dropdown). Open the dialog, change Total Working Days and Priority to distinct new values, submit. Confirm the toast reads "Change proposed — pending QA Lead approval" and the project's Name cell now shows an amber "Rebaseline Pending" badge. Re-open the Rebaseline dialog on the same project and submit again — confirm it's rejected with "This item already has a pending change awaiting approval".

- [ ] **Step 3: Browser walkthrough as QA Lead — approve path**

Sign in as `qa_lead`, open the Approvals page. Confirm the new "Pending Project Changes" card shows the project with correct Current vs Proposed values. Click Approve. Confirm the toast reads "Rebaseline applied", the card entry disappears, and back on the Project Portfolio page the project's Total Working Days/Priority now reflect the proposed values and the "Rebaseline Pending" badge is gone.

- [ ] **Step 4: Browser walkthrough as QA Lead — reject path**

As the PM, propose a second change on the same (now-updated) project. As the QA Lead, click Reject on the Approvals page instead. Confirm the toast reads "Rebaseline rejected", the card entry disappears, and the project's live values are unchanged from before this second proposal (i.e. still the values approved in Step 3, not the newly proposed ones).

- [ ] **Step 5: Clean up**

If any of the values changed during this walkthrough differ from what the project had before testing, restore them via the QA Lead's normal Edit form so the user's live data is left as it was found — matching this app's established live-data testing discipline.
