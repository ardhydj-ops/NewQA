# Allocation Weekly Spillover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Allocation Tool's single-QA "pick a date range" flow and Bulk Assign's "even split" with week-by-week scheduling that caps each week at the QA's real available capacity and spills the rest into following weeks, plus show already-assigned QA names once a project is picked.

**Architecture:** A new shared server-side helper (`scheduleWeeklyAllocations`) walks forward one calendar week at a time from a start date, inserting one allocation row per week (capped at that week's open capacity), until either the target day-total is placed or the project's own end date is reached. Both the single-QA `createAllocation` and the multi-QA `createBulkAllocations` call this same helper — the only difference is Bulk Assign calls it once per selected QA, each against the *same* full remaining-days total (not divided). No DB schema changes — the `allocations` table already supports multiple rows per `(user_id, project_id)` pair.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase/Postgres, Zod 4, TanStack Query 5, sonner toasts. No test framework (verification is `tsc --noEmit` + `eslint` + `npm run build`, matching this project's convention).

## Global Constraints

- Half-day precision throughout: every `days_per_week` value written is a multiple of 0.5, capacity caps are **floored** (`Math.floor(x * 2) / 2`), never rounded, so a cap can never exceed real availability.
- ISO weeks are Monday–Sunday, via the existing `isoWeekRange(date: Date): { start: string; end: string }` in `src/lib/load.ts`.
- Rebaseline (`rebaseline-dialog.tsx`, `updateAllocation`, `proposeAllocationChange`) is out of scope — untouched.
- `assertWithinParallelLimit` (already in `allocation-action.ts`) is called **once per QA per scheduling run**, covering their full intended span (`start_date` through the project's `end_date`) — never once per week-row.
- A mid-loop DB insert failure (rare — all inserts are pre-validated, service-role, same-shape rows) is an accepted edge case: whatever weeks were successfully inserted before the failure stay in the database: `scheduleWeeklyAllocations` does not attempt rollback. This matches the rest of the codebase, which has no multi-row transactional guarantees anywhere else either.

---

### Task 1: Schema field + assigned-QA-names action

**Files:**
- Modify: `src/features/allocation-schema.ts`
- Modify: `src/features/allocation-action.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ScheduleAllocationInput` (Zod schema + inferred type) and `getAssignedQaNames(projectId: string): Promise<string[]>` — both consumed by Task 3 (`allocation-form.tsx`) and Task 2 (`createAllocation`'s new signature).

- [ ] **Step 1: Add `ScheduleAllocationInput` to `src/features/allocation-schema.ts`**

Add this new export at the end of the file (after `BulkAllocationInput`):

```ts
export const ScheduleAllocationInput = z.object({
  user_id: z.string().uuid("Select a tester"),
  project_id: z.string().uuid("Select a project"),
  role_on_project: z.string().trim().min(1, "Role on project is required"),
  start_date: isoDate,
  priority: z.enum(["low", "medium", "high", "critical"]),
});
export type ScheduleAllocationInput = z.infer<typeof ScheduleAllocationInput>;
```

This is a parallel schema to `AllocationInput` for the create-and-schedule flow only — `AllocationInput` itself is untouched and keeps serving `updateAllocation` (rebaseline).

- [ ] **Step 2: Add `getAssignedQaNames` to `src/features/allocation-action.ts`**

Add this new export anywhere after `getAllocationsForProject` (it follows the same read-only, cookie-scoped-client pattern):

```ts
/** Distinct names of QAs already *approved* on this project, for display when picking a target project. */
export async function getAssignedQaNames(projectId: string): Promise<string[]> {
  const supabase = await createClient();

  const { data: allocations, error } = await supabase
    .from("allocations")
    .select("user_id")
    .eq("project_id", projectId)
    .eq("approval_status", "approved");
  if (error) throw new Error(error.message);

  const userIds = [...new Set((allocations ?? []).map((a) => a.user_id))];
  if (userIds.length === 0) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("name")
    .in("id", userIds);
  if (profilesError) throw new Error(profilesError.message);

  return (profiles ?? []).map((p) => p.name);
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`

Expected: zero errors (both are pure additions; nothing else references them yet).

Run: `npx eslint src/features/allocation-schema.ts src/features/allocation-action.ts`

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/features/allocation-schema.ts src/features/allocation-action.ts
git commit -m "feat: add ScheduleAllocationInput schema and getAssignedQaNames action"
```

---

### Task 2: Weekly scheduling helper + rewrite createAllocation/createBulkAllocations

**Files:**
- Modify: `src/features/allocation-action.ts`

**Interfaces:**
- Consumes: `ScheduleAllocationInput` (Task 1), existing `assertWithinParallelLimit`, `monthlyDaysForUser`/`weeksBetween`/`isoWeekRange` from `@/lib/load`, `Priority` type from `@/lib/project`.
- Produces: `createAllocation(input: unknown): Promise<{ weeksCreated: number; placedDays: number; unplacedDays: number }>` (signature and return type both change) and `createBulkAllocations(input: unknown): Promise<{ created: { userId: string; weeksCreated: number; placedDays: number; unplacedDays: number }[]; failed: { userId: string; reason: string }[] }>` (return type changes) — both consumed by Task 3 (`allocation-form.tsx`) and Task 4 (`bulk-assign-dialog.tsx`) respectively.

- [ ] **Step 1: Update imports**

Change:

```ts
import { monthlyDaysForUser, overlappingProjectCount, weeksBetween } from "@/lib/load";
import type { Allocation } from "@/lib/allocation";
```

to:

```ts
import { isoWeekRange, monthlyDaysForUser, overlappingProjectCount, weeksBetween } from "@/lib/load";
import type { Allocation } from "@/lib/allocation";
import type { Priority } from "@/lib/project";
```

Change:

```ts
import {
  AllocationInput,
  AllocationChangeInput,
  BulkAllocationInput,
} from "@/features/allocation-schema";
```

to:

```ts
import {
  AllocationInput,
  AllocationChangeInput,
  BulkAllocationInput,
  ScheduleAllocationInput,
} from "@/features/allocation-schema";
```

- [ ] **Step 2: Add the `scheduleWeeklyAllocations` helper**

Add this new function directly after `assertWithinParallelLimit` (it's the next thing `createAllocation`/`createBulkAllocations` will call):

```ts
type ScheduleResult = { weeksCreated: number; placedDays: number; unplacedDays: number };

/**
 * Places `totalDays` of work for `userId` on `projectId`, one allocation
 * row per calendar week, starting from the Monday..Sunday week containing
 * `startDateISO`. Each week's row is capped at that week's actual open
 * capacity (weekly capacity minus the user's other approved allocations
 * overlapping that week, floored to a half-day so the cap never exceeds
 * real availability) — never blocks, just spills whatever doesn't fit into
 * the following week. Stops once `totalDays` is placed or the walk reaches
 * `projectEndDateISO`, whichever comes first (every project has a required
 * `end_date`, so this loop is always bounded).
 */
async function scheduleWeeklyAllocations(params: {
  admin: AdminClient;
  userId: string;
  projectId: string;
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
    roleOnProject,
    priority,
    totalDays,
    startDateISO,
    projectEndDateISO,
    isLead,
    proposedBy,
  } = params;

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("capacity_days")
    .eq("id", userId)
    .single();
  if (profileError || !profile) throw new Error(profileError?.message ?? "Resource not found");

  // Snapshot taken once, before the loop: every row this loop creates is
  // scoped to its own distinct week, so none of them overlap any other
  // week this same run schedules — the snapshot staying fixed is correct,
  // not a staleness bug.
  const { data: existingAllocations, error: existingError } = await admin
    .from("allocations")
    .select("user_id, project_id, days_per_week, start_date, end_date")
    .eq("user_id", userId)
    .eq("approval_status", "approved");
  if (existingError) throw new Error(existingError.message);

  if (isLead) {
    await assertWithinParallelLimit(admin, userId, projectId, startDateISO, projectEndDateISO);
  }

  let remaining = totalDays;
  let week = isoWeekRange(new Date(`${startDateISO}T00:00:00Z`));
  let weeksCreated = 0;
  let placedDays = 0;

  while (remaining >= 0.5 && week.start <= projectEndDateISO) {
    const allocatedThisWeek = monthlyDaysForUser(existingAllocations ?? [], userId, week);
    const weekCapacity = Math.max(0, profile.capacity_days - allocatedThisWeek);
    const thisWeekDays = Math.min(remaining, Math.floor(weekCapacity * 2) / 2);

    if (thisWeekDays >= 0.5) {
      const rowStart = week.start > startDateISO ? week.start : startDateISO;
      const rowEnd = week.end < projectEndDateISO ? week.end : projectEndDateISO;

      const { error } = await admin.from("allocations").insert({
        user_id: userId,
        project_id: projectId,
        role_on_project: roleOnProject,
        days_per_week: thisWeekDays,
        start_date: rowStart,
        end_date: rowEnd,
        priority,
        approval_status: isLead ? "approved" : "pending",
        proposed_by: isLead ? null : proposedBy,
      });
      if (error) throw new Error(error.message);

      weeksCreated++;
      placedDays += thisWeekDays;
      remaining -= thisWeekDays;
    }

    const nextMonday = new Date(`${week.start}T00:00:00Z`);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
    week = isoWeekRange(nextMonday);
  }

  return { weeksCreated, placedDays, unplacedDays: Math.max(0, Math.round(remaining * 2) / 2) };
}
```

- [ ] **Step 3: Rewrite `createAllocation`**

Replace the entire function:

```ts
export async function createAllocation(input: unknown): Promise<{ success: true }> {
  const profile = await requireRole(["qa_lead", "project_manager"]);

  const parsed = AllocationInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("approval_status")
    .eq("id", parsed.data.project_id)
    .single();

  if (!project || project.approval_status !== "approved") {
    throw new Error("You can only assign testers to an approved project");
  }

  const isLead = profile.role === "qa_lead";

  if (isLead) {
    await assertWithinParallelLimit(
      admin,
      parsed.data.user_id,
      parsed.data.project_id,
      parsed.data.start_date,
      parsed.data.end_date ?? null,
    );
  }

  const { error } = await admin.from("allocations").insert({
    user_id: parsed.data.user_id,
    project_id: parsed.data.project_id,
    role_on_project: parsed.data.role_on_project,
    days_per_week: parsed.data.days_per_week,
    start_date: parsed.data.start_date,
    end_date: parsed.data.end_date ?? null,
    priority: parsed.data.priority,
    approval_status: isLead ? "approved" : "pending",
    proposed_by: isLead ? null : profile.id,
  });

  if (error) throw new Error(error.message);
  return { success: true };
}
```

with:

```ts
export async function createAllocation(
  input: unknown,
): Promise<{ weeksCreated: number; placedDays: number; unplacedDays: number }> {
  const profile = await requireRole(["qa_lead", "project_manager"]);

  const parsed = ScheduleAllocationInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("approval_status, end_date, total_working_days")
    .eq("id", parsed.data.project_id)
    .single();

  if (projectError || !project || project.approval_status !== "approved") {
    throw new Error("You can only assign testers to an approved project");
  }
  if (!project.end_date) {
    throw new Error("This item has no end date and can't be scheduled");
  }

  const { data: existingProjectAllocations, error: existingError } = await admin
    .from("allocations")
    .select("days_per_week, start_date, end_date")
    .eq("project_id", parsed.data.project_id)
    .eq("approval_status", "approved");
  if (existingError) throw new Error(existingError.message);

  const committed = (existingProjectAllocations ?? []).reduce(
    (sum, a) => sum + a.days_per_week * weeksBetween(a.start_date, a.end_date ?? project.end_date!),
    0,
  );
  const remainingDays = Math.max(0, project.total_working_days - committed);

  const isLead = profile.role === "qa_lead";

  return scheduleWeeklyAllocations({
    admin,
    userId: parsed.data.user_id,
    projectId: parsed.data.project_id,
    roleOnProject: parsed.data.role_on_project,
    priority: parsed.data.priority,
    totalDays: remainingDays,
    startDateISO: parsed.data.start_date,
    projectEndDateISO: project.end_date,
    isLead,
    proposedBy: isLead ? null : profile.id,
  });
}
```

- [ ] **Step 4: Rewrite `createBulkAllocations`**

Replace the doc comment and function body:

```ts
/**
 * Assigns one project/activity to several QAs at once, splitting its
 * `total_working_days` evenly (per QA, per week, over the item's own
 * date range, rounded to the nearest half-day and floored at 0.5 so a
 * thin split never rounds down to a DB-rejected 0). Each QA gets an
 * independent allocation row. QA-Lead batches go live immediately
 * (per-QA, subject to the parallel-limit check); PM batches are
 * standalone `pending` proposals, same rule as the single-QA flow.
 * Partial success is expected and reported — one QA failing the limit
 * check doesn't block the others.
 */
export async function createBulkAllocations(
  input: unknown,
): Promise<{ created: string[]; failed: { userId: string; reason: string }[] }> {
  const profile = await requireRole(["qa_lead", "project_manager"]);

  const parsed = BulkAllocationInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("approval_status, start_date, end_date, total_working_days")
    .eq("id", parsed.data.project_id)
    .single();

  if (projectError || !project || project.approval_status !== "approved") {
    throw new Error("You can only assign testers to an approved project");
  }
  if (!project.end_date) {
    throw new Error("This item has no end date and can't be evenly split");
  }

  const { data: existingAllocations, error: existingError } = await admin
    .from("allocations")
    .select("days_per_week, start_date, end_date")
    .eq("project_id", parsed.data.project_id)
    .eq("approval_status", "approved");
  if (existingError) throw new Error(existingError.message);

  const committed = (existingAllocations ?? []).reduce(
    (sum, a) => sum + a.days_per_week * weeksBetween(a.start_date, a.end_date ?? project.end_date!),
    0,
  );
  const remainingDays = Math.max(0, project.total_working_days - committed);

  const weeks = weeksBetween(project.start_date, project.end_date);
  // Floored at 0.5 (not rounded down to 0) — the DB's days_per_week > 0
  // check would otherwise reject a QA whose even share rounds to nothing.
  const daysPerWeek = Math.max(0.5, Math.round((remainingDays / parsed.data.user_ids.length / weeks) * 2) / 2);
  const isLead = profile.role === "qa_lead";

  const created: string[] = [];
  const failed: { userId: string; reason: string }[] = [];

  for (const userId of parsed.data.user_ids) {
    if (isLead) {
      try {
        await assertWithinParallelLimit(admin, userId, parsed.data.project_id, project.start_date, project.end_date);
      } catch (limitError) {
        failed.push({ userId, reason: (limitError as Error).message });
        continue;
      }
    }

    const { error } = await admin.from("allocations").insert({
      user_id: userId,
      project_id: parsed.data.project_id,
      role_on_project: parsed.data.role_on_project,
      days_per_week: daysPerWeek,
      start_date: project.start_date,
      end_date: project.end_date,
      priority: "medium",
      approval_status: isLead ? "approved" : "pending",
      proposed_by: isLead ? null : profile.id,
    });

    if (error) {
      failed.push({ userId, reason: error.message });
    } else {
      created.push(userId);
    }
  }

  return { created, failed };
}
```

with:

```ts
/**
 * Assigns one project/activity to several QAs at once — NOT split: each
 * selected QA is independently scheduled (via `scheduleWeeklyAllocations`)
 * against the project's *full* `total_working_days` remaining total, one
 * allocation row per week they're active, capped at their own real
 * capacity each week and spilling into following weeks as needed. QA-Lead
 * batches go live immediately (per-QA, subject to the parallel-limit
 * check); PM batches are standalone `pending` proposals, same rule as the
 * single-QA flow. Partial success is expected and reported — one QA
 * failing the limit check doesn't block the others.
 */
export async function createBulkAllocations(input: unknown): Promise<{
  created: { userId: string; weeksCreated: number; placedDays: number; unplacedDays: number }[];
  failed: { userId: string; reason: string }[];
}> {
  const profile = await requireRole(["qa_lead", "project_manager"]);

  const parsed = BulkAllocationInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("approval_status, start_date, end_date, total_working_days")
    .eq("id", parsed.data.project_id)
    .single();

  if (projectError || !project || project.approval_status !== "approved") {
    throw new Error("You can only assign testers to an approved project");
  }
  if (!project.end_date) {
    throw new Error("This item has no end date and can't be scheduled");
  }

  const { data: existingAllocations, error: existingError } = await admin
    .from("allocations")
    .select("days_per_week, start_date, end_date")
    .eq("project_id", parsed.data.project_id)
    .eq("approval_status", "approved");
  if (existingError) throw new Error(existingError.message);

  const committed = (existingAllocations ?? []).reduce(
    (sum, a) => sum + a.days_per_week * weeksBetween(a.start_date, a.end_date ?? project.end_date!),
    0,
  );
  const remainingDays = Math.max(0, project.total_working_days - committed);
  const isLead = profile.role === "qa_lead";

  const created: { userId: string; weeksCreated: number; placedDays: number; unplacedDays: number }[] = [];
  const failed: { userId: string; reason: string }[] = [];

  for (const userId of parsed.data.user_ids) {
    try {
      const result = await scheduleWeeklyAllocations({
        admin,
        userId,
        projectId: parsed.data.project_id,
        roleOnProject: parsed.data.role_on_project,
        priority: "medium",
        totalDays: remainingDays,
        startDateISO: project.start_date,
        projectEndDateISO: project.end_date,
        isLead,
        proposedBy: isLead ? null : profile.id,
      });
      created.push({ userId, ...result });
    } catch (scheduleError) {
      failed.push({ userId, reason: (scheduleError as Error).message });
    }
  }

  return { created, failed };
}
```

- [ ] **Step 5: Verify — expect errors only in files not yet updated**

Run: `npx tsc --noEmit`

Expected: errors in `src/components/allocations/allocation-form.tsx` and `src/components/allocations/bulk-assign-dialog.tsx` (they still call the old signatures — Tasks 3 and 4 fix this). Zero errors inside `src/features/allocation-action.ts` itself.

Run: `npx eslint src/features/allocation-action.ts`

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/features/allocation-action.ts
git commit -m "feat: replace even-split allocation with weekly capacity-capped scheduling"
```

---

### Task 3: Allocation Details form — drop End Date, show assigned QAs, use the new schedule flow

**Files:**
- Modify: `src/components/allocations/allocation-form.tsx`

**Interfaces:**
- Consumes: `ScheduleAllocationInput`-shaped payload accepted by `createAllocation` (Task 2, now `{ user_id, project_id, role_on_project, start_date, priority }`), its new return type `{ weeksCreated, placedDays, unplacedDays }`, and `getAssignedQaNames` (Task 1).
- Produces: nothing consumed by later tasks (this form is a leaf).

- [ ] **Step 1: Replace the entire file**

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createAllocation, getAssignedQaNames, getRemainingProjectDays } from "@/features/allocation-action";
import { cn } from "@/lib/utils";
import type { Priority, Project } from "@/lib/project";
import type { ProfileRole } from "@/lib/profile";

type AllocationFormProps = {
  userId: string;
  userName: string;
  capacityDays: number;
  allocatedDays: number;
  projects: Project[];
  role: ProfileRole;
};

export function AllocationForm({ userId, userName, capacityDays, allocatedDays, projects, role }: AllocationFormProps) {
  const [projectId, setProjectId] = useState("");
  const [projectPopoverOpen, setProjectPopoverOpen] = useState(false);
  const [roleOnProject, setRoleOnProject] = useState("");
  const [startDate, setStartDate] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const queryClient = useQueryClient();

  const selectedProject = projects.find((p) => p.id === projectId) ?? null;

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

  function handleProjectChange(value: string) {
    setProjectId(value);
    const project = projects.find((p) => p.id === value);
    setStartDate(project?.start_date ?? "");
  }

  const remainingCapacity = Math.max(0, capacityDays - allocatedDays);
  const roundedRemainingCapacity = Math.round(remainingCapacity * 2) / 2;
  const canSubmit = projectId !== "" && roleOnProject.trim() !== "" && startDate !== "";

  const mutation = useMutation({
    mutationFn: () =>
      createAllocation({
        user_id: userId,
        project_id: projectId,
        role_on_project: roleOnProject,
        start_date: startDate,
        priority,
      }),
    onSuccess: (result) => {
      if (result.unplacedDays > 0) {
        toast.warning(
          `Scheduled ${result.placedDays} day(s) across ${result.weeksCreated} week(s) — ${result.unplacedDays} day(s) couldn't fit before the project's deadline.`,
        );
      } else {
        toast.success(
          role === "qa_lead"
            ? `Assigned across ${result.weeksCreated} week(s)`
            : `Proposed across ${result.weeksCreated} week(s) — pending QA Lead approval`,
        );
      }
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["range-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", userId] });
      queryClient.invalidateQueries({ queryKey: ["remaining-project-days", projectId] });
      queryClient.invalidateQueries({ queryKey: ["assigned-qa-names", projectId] });
      setProjectId("");
      setRoleOnProject("");
      setStartDate("");
      setPriority("medium");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      className="space-y-4"
    >
      <div className="rounded-md border bg-muted px-3 py-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Selected Resource</span>
          <span className="font-medium">{userName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Remaining Capacity</span>
          <span className="font-medium">{roundedRemainingCapacity} days / week</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="project">Target Project</Label>
        <Popover open={projectPopoverOpen} onOpenChange={setProjectPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              id="project"
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={projectPopoverOpen}
              className="w-full justify-between font-normal"
            >
              <span className={cn("truncate", !selectedProject && "text-muted-foreground")}>
                {selectedProject ? selectedProject.name : "Select a project..."}
              </span>
              <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
            <Command>
              <CommandInput placeholder="Search projects..." />
              <CommandList>
                <CommandEmpty>No projects found.</CommandEmpty>
                <CommandGroup>
                  {projects.map((project) => (
                    <CommandItem
                      key={project.id}
                      value={project.name}
                      onSelect={() => {
                        handleProjectChange(project.id);
                        setProjectPopoverOpen(false);
                      }}
                    >
                      <Check className={cn("size-4", project.id === projectId ? "opacity-100" : "opacity-0")} />
                      {project.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {selectedProject && (
          <>
            <p className="text-xs text-muted-foreground">
              Remaining days for this item:{" "}
              {remainingDays !== undefined ? `${Math.round(remainingDays * 2) / 2} days` : "..."}
            </p>
            {assignedQaNames && assignedQaNames.length > 0 && (
              <p className="text-xs text-muted-foreground">Already assigned: {assignedQaNames.join(", ")}</p>
            )}
          </>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="role_on_project">Role on Project</Label>
        <Input
          id="role_on_project"
          value={roleOnProject}
          onChange={(e) => setRoleOnProject(e.target.value)}
          placeholder="e.g. Lead QA"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="priority">Priority</Label>
        <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
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

      <div className="space-y-2">
        <Label htmlFor="start_date">Start Date</Label>
        <Input
          id="start_date"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          min={selectedProject?.start_date}
          max={selectedProject?.end_date ?? undefined}
          required
          disabled={!projectId}
        />
      </div>

      {startDate !== "" && (
        <p className="text-sm text-muted-foreground">
          Assigned days are scheduled week by week at this QA&apos;s available capacity, continuing into future
          weeks as needed.
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={!canSubmit || mutation.isPending}>
          {mutation.isPending ? "Assigning..." : role === "qa_lead" ? "Assign Resource" : "Propose Assignment"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`

Expected: zero errors in `allocation-form.tsx` itself. Errors remain in `bulk-assign-dialog.tsx` (Task 4).

Run: `npx eslint src/components/allocations/allocation-form.tsx`

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/allocations/allocation-form.tsx
git commit -m "feat: switch Allocation Details to weekly-scheduled assignment, show assigned QAs"
```

---

### Task 4: Bulk Assign — drop even-split framing, adapt to the new per-QA scheduling result

**Files:**
- Modify: `src/components/allocations/bulk-assign-dialog.tsx`

**Interfaces:**
- Consumes: `createBulkAllocations`'s new return type from Task 2 (`{ created: { userId; weeksCreated; placedDays; unplacedDays }[]; failed: { userId; reason }[] }`).
- Produces: nothing consumed by later tasks (this dialog is a leaf).

- [ ] **Step 1: Drop the unused `weeksBetween` import**

Change:

```ts
import { createBulkAllocations, getRemainingProjectDays } from "@/features/allocation-action";
import { getAssignableProfiles } from "@/features/profile-action";
import { getProjects } from "@/features/project-action";
import { weeksBetween } from "@/lib/load";
import type { Project } from "@/lib/project";
```

to:

```ts
import { createBulkAllocations, getRemainingProjectDays } from "@/features/allocation-action";
import { getAssignableProfiles } from "@/features/profile-action";
import { getProjects } from "@/features/project-action";
import type { Project } from "@/lib/project";
```

- [ ] **Step 2: Remove the even-split preview calculation**

Change:

```ts
  const selectedProject = presetProject ?? (projects ?? []).find((p) => p.id === projectId) ?? null;

  const { data: remainingDays } = useQuery({
    queryKey: ["remaining-project-days", projectId],
    queryFn: () => getRemainingProjectDays(projectId),
    enabled: projectId !== "",
  });

  const previewDaysPerWeek =
    selectedProject && selectedProject.end_date && remainingDays !== undefined && selectedUserIds.length > 0
      ? Math.round(
          (remainingDays / selectedUserIds.length / weeksBetween(selectedProject.start_date, selectedProject.end_date)) * 2,
        ) / 2
      : null;
```

to:

```ts
  const selectedProject = presetProject ?? (projects ?? []).find((p) => p.id === projectId) ?? null;

  const { data: remainingDays } = useQuery({
    queryKey: ["remaining-project-days", projectId],
    queryFn: () => getRemainingProjectDays(projectId),
    enabled: projectId !== "",
  });
```

- [ ] **Step 3: Update the success handler for the new per-QA result shape**

Change:

```ts
    onSuccess: (result) => {
      if (result.created.length > 0) {
        toast.success(
          role === "qa_lead"
            ? `Assigned ${result.created.length} QA member(s)`
            : `Proposed assignment for ${result.created.length} QA member(s) — pending QA Lead approval`,
        );
      }
      if (result.failed.length > 0) {
        const names = result.failed
          .map((f) => (testers ?? []).find((t) => t.id === f.userId)?.name ?? f.userId)
          .join(", ");
        toast.error(`Could not assign: ${names}`);
      }
```

to:

```ts
    onSuccess: (result) => {
      if (result.created.length > 0) {
        const partiallyPlaced = result.created.filter((c) => c.unplacedDays > 0);
        if (partiallyPlaced.length === 0) {
          toast.success(
            role === "qa_lead"
              ? `Assigned ${result.created.length} QA member(s)`
              : `Proposed assignment for ${result.created.length} QA member(s) — pending QA Lead approval`,
          );
        } else {
          const names = partiallyPlaced
            .map((c) => (testers ?? []).find((t) => t.id === c.userId)?.name ?? c.userId)
            .join(", ");
          toast.warning(`Assigned ${result.created.length} QA member(s), but couldn't fit all days for: ${names}`);
        }
      }
      if (result.failed.length > 0) {
        const names = result.failed
          .map((f) => (testers ?? []).find((t) => t.id === f.userId)?.name ?? f.userId)
          .join(", ");
        toast.error(`Could not assign: ${names}`);
      }
```

- [ ] **Step 4: Update the dialog title, description, and remove the preview line**

Change:

```tsx
        <DialogHeader>
          <DialogTitle>{presetProject ? "Assign QA (even split)" : "Add project (even split)"}</DialogTitle>
          <DialogDescription>
            Remaining working days are split evenly across the QA members you select.
          </DialogDescription>
        </DialogHeader>
```

to:

```tsx
        <DialogHeader>
          <DialogTitle>{presetProject ? "Assign QA" : "Add project"}</DialogTitle>
          <DialogDescription>
            Each selected QA is scheduled for the full remaining workload at their own available capacity,
            spilling into future weeks as needed.
          </DialogDescription>
        </DialogHeader>
```

Change:

```tsx
          {previewDaysPerWeek !== null && (
            <p className="text-sm text-muted-foreground">
              Each selected QA gets ~{previewDaysPerWeek} days/week.
            </p>
          )}

          <DialogFooter>
```

to:

```tsx
          <DialogFooter>
```

- [ ] **Step 5: Verify — the whole app compiles clean**

Run: `npx tsc --noEmit`

Expected: zero errors, anywhere.

Run: `npx eslint`

Expected: zero errors/warnings, anywhere.

Run: `npm run build`

Expected: `✓ Compiled successfully` and the full route listing, matching every previous successful build in this project's history.

- [ ] **Step 6: Commit**

```bash
git add src/components/allocations/bulk-assign-dialog.tsx
git commit -m "feat: adapt Bulk Assign to per-QA weekly scheduling, drop even-split framing"
```

---

### Task 5: Browser smoke test and finish

**Files:** none (verification only).

**Interfaces:**
- Consumes: the fully-implemented feature from Tasks 1–4.
- Produces: nothing (terminal task).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background; if port 3000 is already in use by another dev server, use whatever port it lands on, or reuse the existing one at `localhost:3000`).

- [ ] **Step 2: Single-QA assignment — full placement**

Navigate to `/allocations`. Select a QA resource with open capacity. Pick a target project that has plenty of remaining days and open weeks ahead. Confirm: no End Date field is present; "Already assigned" shows up once a project with existing assignees is picked (or is absent for a project with none); picking a Start Date shows the static "scheduled week by week..." note; submitting shows a success toast naming how many weeks it spanned. Open the Current Assignments table below and confirm multiple rows appeared for that QA/project (one per week, if it spanned more than one week) each with a sensible `days_per_week`.

- [ ] **Step 3: Single-QA assignment — spillover**

Pick a QA who already has a nearly-full week (low remaining capacity that week) and assign them to a project with several remaining days. Confirm the toast/created rows reflect the work spilling into the following week(s) rather than being blocked.

- [ ] **Step 4: Bulk Assign**

Click "Add Project", pick a project and 2+ QAs, submit. Confirm the dialog no longer mentions "even split" and the description reads the new capacity-scheduling copy. After submitting, confirm (via the Current Assignments table for each of the selected QAs) that each one received their own full set of weekly rows covering the *entire* remaining total — not a fraction of it each.

- [ ] **Step 5: Close the browser tab and stop the dev server**

Close any tabs opened for this check; stop the background `npm run dev` process if it isn't the user's own pre-existing server (check its log for a port-conflict message first — if it reports another server is already running on port 3000, it already exited on its own and there's nothing to stop).

- [ ] **Step 6: Finish the development branch**

Announce and use **superpowers:finishing-a-development-branch** to verify the full commit history on this branch, then present the merge/PR/keep-as-is menu.

---

## Self-Review Notes

- **Spec coverage:** §1 (assigned-QA display) → Task 1 + Task 3. §2 (weekly spillover for single-QA) → Task 2 (`scheduleWeeklyAllocations` + `createAllocation`) + Task 3 (form changes). §3 (Bulk Assign rework) → Task 2 (`createBulkAllocations`) + Task 4 (dialog changes). "Out of scope" (rebaseline untouched, no schema change, no dry-run preview) — confirmed no task touches `rebaseline-dialog.tsx`, `updateAllocation`, `proposeAllocationChange`, or any migration file.
- **Type consistency verified:** `createAllocation`'s new return type `{ weeksCreated, placedDays, unplacedDays }` matches between its Task 2 definition and Task 3's `mutationFn`/`onSuccess` usage. `createBulkAllocations`'s new return type matches between Task 2's definition and Task 4's `onSuccess` usage (`result.created` as an array of objects with `.userId`/`.unplacedDays`, not a plain string array). `getAssignedQaNames(projectId: string): Promise<string[]>` matches between Task 1's definition and Task 3's `useQuery` call. `ScheduleAllocationInput`'s fields (`user_id, project_id, role_on_project, start_date, priority` — no `end_date`, no `days_per_week`) match exactly what Task 3's `mutationFn` sends.
- **Removed-field check:** grepped the plan's own Task 3 replacement file for `endDate`/`end_date` (only appears as `selectedProject?.end_date` for the Start Date input's `max` bound — correct, intentional) and for `getRemainingUserCapacity`/`weeksBetween` (both absent — correct, no longer needed once End Date and the flat computed-rate logic are gone).
