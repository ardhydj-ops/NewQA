# QA Resource Manager v4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the v4 changes from `docs/superpowers/specs/2026-08-11-qa-resource-manager-v4-design.md` on top of the shipped v1–v3 app: a Dashboard redesign (merged summary cards, a merged QA-Group/Resource-Load card, a product-demand pie chart, and a monthly project calendar replacing the old per-member/per-project lists), Project Portfolio workflow changes (PM proposals hide Total Working Hours until Lead approval, no Progress field on create, required JIRA/Jiva links), and an Allocation Tool overhaul that replaces manual weekly-hours entry with dates-drive-hours math tied to a project's remaining unallocated hours.

**Architecture:** Same conventions as v1–v3 — `"use server"` action files per feature, Zod validation, TanStack React Query on the client, shadcn/ui, sonner toasts, service-role client for all writes. Most tasks replace the full content of an existing file; a few are net-new files, including the first third-party UI dependency this app has needed (`recharts`, for the pie chart).

**Tech Stack:** Next.js 16.2.6, React 19.2.4, Supabase, TanStack Query 5, Zod 4, shadcn/ui, Tailwind 4, plus new: `recharts`.

## Global Constraints

- All INSERT/UPDATE/DELETE still go through `createAdminClient()`; all SELECT reads still go through the cookie-scoped `createClient()`. No change to this v1 rule.
- `jira_link`/`jiva_link` are DB-nullable-with-empty-default (soft migration, same reasoning as v2's `total_working_hours`/`priority`) but **required in the Zod schema/form** for every create and edit going forward, including PM proposals.
- `total_working_hours` becomes the one field where the *opposite* split applies: still required for QA-Lead-direct create/edit, but **optional** specifically on the PM proposal path (defaults to 0, filled in by the Lead at approval time).
- The Allocation Tool's `hours_per_week` is still a **client-computed, client-trusted** value submitted as-is to `createAllocation`/`updateAllocation` — no new server-side re-derivation there, consistent with v1–v3. `createBulkAllocations` is the one place hours are already computed server-side (v2), and that computation is what's being corrected to use remaining instead of total hours.
- Verification per task: `npx tsc --noEmit`, `npx eslint <changed files>`. No automated test framework, same as v1–v3. Pure-logic additions (`src/lib/calendar.ts`) get a disposable `npx tsx` scratch-verification script, deleted after use, matching the `src/lib/load.ts` convention.
- Migrations are applied manually via the Supabase Dashboard SQL Editor, same as v1–v3.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/0004_qa_resource_manager_v4.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `public.projects.jira_link` and `public.projects.jiva_link` (`text not null default ''`). Consumed by every later task touching `Project`/`ProjectInput`.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0004_qa_resource_manager_v4.sql`:

```sql
-- QA Resource Manager v4 — JIRA/Jiva tracking links on work items.
-- Run via Supabase Dashboard -> SQL Editor -> paste -> Run.

alter table public.projects
  add column if not exists jira_link text not null default '',
  add column if not exists jiva_link text not null default '';
```

Note: nullable-with-empty-default at the DB level (existing rows get `''`, not broken by
a `NOT NULL` constraint with no default) — "required" for real is enforced entirely in
the Zod schema (Task 3) and forms (Task 12), same soft-migration approach v2 used for
`total_working_hours`/`priority`.

- [ ] **Step 2: Apply the migration**

Supabase Dashboard -> SQL Editor -> paste the full file contents -> Run.
Expected: no errors. Table Editor -> confirm `projects` has `jira_link`/`jiva_link`
columns, both `''` on existing rows.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0004_qa_resource_manager_v4.sql
git commit -m "feat: add jira_link/jiva_link columns to projects"
```

---

### Task 2: Shared types — Project links + calendar helpers

**Files:**
- Modify: `src/lib/project.ts`
- Create: `src/lib/calendar.ts`

**Interfaces:**
- Consumes: nothing (pure types/functions).
- Produces: `Project` gains `jira_link: string; jiva_link: string`. New from `@/lib/calendar`: `CalendarDay`, `CalendarWeek`, `buildCalendarGrid(year, monthIndex0): CalendarWeek[]`, `CalendarBar`, `packWeekBars(week, projects): CalendarBar[]`. Consumed starting Task 3 (types) and Task 9 (calendar UI).

- [ ] **Step 1: Update `src/lib/project.ts`**

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
  jira_link: string;
  jiva_link: string;
  approval_status: ApprovalStatus;
  proposed_by: string | null;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 2: Write `src/lib/calendar.ts`**

```ts
export type CalendarDay = { date: string; inCurrentMonth: boolean };
export type CalendarWeek = CalendarDay[];

function formatISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 6 rows x 7 cols (Mon-Sun) covering the full display grid for a month. */
export function buildCalendarGrid(year: number, monthIndex0: number): CalendarWeek[] {
  const firstOfMonth = new Date(Date.UTC(year, monthIndex0, 1));
  const firstWeekday = firstOfMonth.getUTCDay(); // 0 = Sunday
  const diffToMonday = firstWeekday === 0 ? -6 : 1 - firstWeekday;
  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(firstOfMonth.getUTCDate() + diffToMonday);

  const weeks: CalendarWeek[] = [];
  const cursor = new Date(gridStart);
  for (let w = 0; w < 6; w++) {
    const week: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({ date: formatISODate(cursor), inCurrentMonth: cursor.getUTCMonth() === monthIndex0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export type CalendarBar = {
  projectId: string;
  startCol: number; // 0-6 within the week
  endCol: number; // 0-6 within the week, inclusive
  lane: number;
};

/**
 * Greedy interval-packing for one week: clips each project's range to the
 * week's [start,end], converts to 0-6 day-of-week columns, and assigns each
 * segment to the lowest lane whose previously-placed segment doesn't overlap
 * it — the standard "calendar event stacking" algorithm.
 */
export function packWeekBars(
  week: CalendarWeek,
  projects: { id: string; start_date: string; end_date: string | null }[],
): CalendarBar[] {
  const weekStart = week[0].date;
  const weekEnd = week[6].date;

  const segments = projects
    .filter((p) => p.start_date <= weekEnd && (p.end_date === null || p.end_date >= weekStart))
    .map((p) => {
      const segStart = p.start_date > weekStart ? p.start_date : weekStart;
      const segEndRaw = p.end_date === null || p.end_date > weekEnd ? weekEnd : p.end_date;
      const startCol = week.findIndex((d) => d.date === segStart);
      const endCol = week.findIndex((d) => d.date === segEndRaw);
      return { projectId: p.id, startCol, endCol };
    })
    .sort((a, b) => a.startCol - b.startCol || a.endCol - b.endCol);

  const laneEndCols: number[] = [];
  const bars: CalendarBar[] = [];
  for (const seg of segments) {
    let lane = laneEndCols.findIndex((endCol) => endCol < seg.startCol);
    if (lane === -1) {
      lane = laneEndCols.length;
      laneEndCols.push(seg.endCol);
    } else {
      laneEndCols[lane] = seg.endCol;
    }
    bars.push({ ...seg, lane });
  }
  return bars;
}
```

- [ ] **Step 3: Write and run a scratch verification script**

Create `scratch-verify-calendar.ts` at the repo root (temporary, not committed):

```ts
import { buildCalendarGrid, packWeekBars } from "@/lib/calendar";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// August 2026: Aug 1 is a Saturday -> grid starts Monday July 27.
const grid = buildCalendarGrid(2026, 7);
assertEqual(grid.length, 6, "6 week rows");
assertEqual(grid[0][0], { date: "2026-07-27", inCurrentMonth: false }, "grid starts Mon before month");
assertEqual(grid[0][5], { date: "2026-08-01", inCurrentMonth: true }, "Aug 1 is a Saturday in week 0");
assertEqual(grid[5][6].date, "2026-09-06", "grid always has 6 full weeks (42 days) from its start");

const week = grid[0]; // 2026-07-27 .. 2026-08-02
// One project fully inside the week, one starting before and ending inside, one spanning the whole week.
const bars = packWeekBars(week, [
  { id: "a", start_date: "2026-07-28", end_date: "2026-07-29" },
  { id: "b", start_date: "2026-07-20", end_date: "2026-07-27" },
  { id: "c", start_date: "2026-07-25", end_date: "2026-08-10" },
]);
assertEqual(bars.length, 3, "all three projects produce a bar");
const byId = new Map(bars.map((b) => [b.projectId, b]));
assertEqual(byId.get("b"), { projectId: "b", startCol: 0, endCol: 0, lane: 0 }, "b clipped to week start, lane 0");
assertEqual(byId.get("c"), { projectId: "c", startCol: 0, endCol: 6, lane: 1 }, "c spans full week, lane 1 (b occupies lane 0 at col 0)");
assertEqual(byId.get("a"), { projectId: "a", startCol: 1, endCol: 2, lane: 0 }, "a starts after b's lane 0 frees up at col 1, reuses lane 0");

// No overlap at all -> only one project.
const emptyWeek = grid[5];
assertEqual(packWeekBars(emptyWeek, []), [], "no projects -> no bars");

console.log("OK: calendar.ts passes all cases");
```

Run: `npx tsx scratch-verify-calendar.ts`
Expected: prints `OK: calendar.ts passes all cases`, exits 0.

- [ ] **Step 4: Delete the scratch script**

```bash
rm scratch-verify-calendar.ts
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: errors in every file that constructs a `Project` object literal without
`jira_link`/`jiva_link`, or references the deleted... nothing is deleted this task, this
is purely additive. Confirm the error list only touches
`src/features/project-schema.ts`/`project-action.ts` (once Task 3/4 land, not yet) — for
now, `src/lib/*` and `src/lib/calendar.ts` should show zero errors on their own.

- [ ] **Step 6: Commit**

```bash
git add src/lib/project.ts src/lib/calendar.ts
git commit -m "feat: add jira_link/jiva_link to Project type; add calendar grid/packing helpers"
```

---

### Task 3: Zod schema updates

**Files:**
- Modify: `src/features/project-schema.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces: `ProjectInput` gains required `jira_link`/`jiva_link` (URL-validated); new `ProjectProposalProjectInput` (= `ProjectInput` with `total_working_hours` made optional via `.partial()`) used by `ProjectProposalInput`; new `ApproveProjectProposalInput = { total_working_hours: number (positive) }`. Consumed starting Task 4 (`project-action.ts`) and Task 5 (`approval-action.ts`).

- [ ] **Step 1: Replace `src/features/project-schema.ts`**

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
  jira_link: z.string().trim().url("Enter a valid JIRA URL"),
  jiva_link: z.string().trim().url("Enter a valid Jiva URL"),
});
export type ProjectInput = z.infer<typeof ProjectInput>;

// PM proposals never set Total Working Hours — the QA Lead fills it in at
// approval time (see ApproveProjectProposalInput below). Every other field,
// including jira_link/jiva_link, stays required on the proposal path too.
const ProjectProposalProjectInput = ProjectInput.partial({ total_working_hours: true });
export type ProjectProposalProjectInput = z.infer<typeof ProjectProposalProjectInput>;

export const ProposedAllocationInput = z.object({
  user_id: z.string().uuid("Select a tester"),
  role_on_project: z.string().trim().min(1, "Role on project is required"),
  hours_per_week: z.number().positive("Hours must be greater than 0"),
  start_date: isoDate,
  end_date: isoDate.optional(),
});
export type ProposedAllocationInput = z.infer<typeof ProposedAllocationInput>;

export const ProjectProposalInput = z.object({
  project: ProjectProposalProjectInput,
  allocations: z.array(ProposedAllocationInput).min(1, "Add at least one tester assignment"),
});
export type ProjectProposalInput = z.infer<typeof ProjectProposalInput>;

export const ApproveProjectProposalInput = z.object({
  total_working_hours: z.number().positive("Total working hours must be greater than 0"),
});
export type ApproveProjectProposalInput = z.infer<typeof ApproveProjectProposalInput>;
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors in every file that constructs a `Project`/`ProjectInput` object without
`jira_link`/`jiva_link`, or calls `proposeProject`/`approveProjectProposal` with the old
shapes — expected until Tasks 4–5, 11–12 land. Confirm the error list only touches
`src/features/project-action.ts`, `src/features/approval-action.ts`,
`src/components/projects/*`, `src/components/approvals/*` — no errors outside those.

- [ ] **Step 3: Commit**

```bash
git add src/features/project-schema.ts
git commit -m "feat: add jira_link/jiva_link and PM-optional total_working_hours to project schemas"
```

---

### Task 4: Project Portfolio server actions — links + PM-optional hours

**Files:**
- Modify: `src/features/project-action.ts`

**Interfaces:**
- Consumes: updated `ProjectInput`/`ProjectProposalInput` (Task 3), `Project` (Task 2, now carries `jira_link`/`jiva_link`).
- Produces: same exported function names as v1–v3 (`getProjects`, `createProject`, `updateProject`, `deleteProject`, `proposeProject`, `withdrawProjectProposal`) but `createProject`/`updateProject` now read/write `jira_link`/`jiva_link`, and `proposeProject` writes `jira_link`/`jiva_link` plus `total_working_hours: parsed.data.project.total_working_hours ?? 0`. Consumed starting Task 12.

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
    jira_link: parsed.data.jira_link,
    jiva_link: parsed.data.jiva_link,
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
      jira_link: parsed.data.jira_link,
      jiva_link: parsed.data.jiva_link,
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
      total_working_hours: parsed.data.project.total_working_hours ?? 0,
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
git commit -m "feat: write jira_link/jiva_link; default proposal total_working_hours to 0"
```

---

### Task 5: Approval actions — QA Lead sets Total Working Hours at approval

**Files:**
- Modify: `src/features/approval-action.ts`

**Interfaces:**
- Consumes: `ApproveProjectProposalInput` (Task 3).
- Produces: `approveProjectProposal(projectId: string, input: unknown): Promise<{ success: true }>` — same name, new second parameter. Every other export (`getPendingProjectProposals`, `getPendingAllocationProposals`, `getPendingAllocationChanges`, `rejectProjectProposal`, `approveAllocation`, `rejectAllocation`, `approveAllocationChange`, `rejectAllocationChange`) is unchanged. Consumed starting Task 11.

- [ ] **Step 1: Update `approveProjectProposal` in `src/features/approval-action.ts`**

Replace only this function (everything else in the file stays exactly as-is):

```ts
export async function approveProjectProposal(projectId: string, input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = ApproveProjectProposalInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: allocations, error: fetchError } = await admin
    .from("allocations")
    .select("id, user_id, start_date, end_date")
    .eq("project_id", projectId)
    .eq("approval_status", "pending");
  if (fetchError) throw new Error(fetchError.message);

  for (const allocation of allocations ?? []) {
    await assertWithinParallelLimit(admin, allocation.user_id, projectId, allocation.start_date, allocation.end_date);
  }

  const { error: projectError } = await admin
    .from("projects")
    .update({ approval_status: "approved", total_working_hours: parsed.data.total_working_hours })
    .eq("id", projectId);
  if (projectError) throw new Error(projectError.message);

  const { error: allocationsError } = await admin
    .from("allocations")
    .update({ approval_status: "approved" })
    .eq("project_id", projectId)
    .eq("approval_status", "pending");
  if (allocationsError) throw new Error(allocationsError.message);

  return { success: true };
}
```

And add the import at the top of the file, alongside the existing imports:

```ts
import { ApproveProjectProposalInput } from "@/features/project-schema";
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: `src/features/approval-action.ts` no longer appears in the error list.
`src/components/approvals/approvals-page-content.tsx` now shows a *new* error (calling
`approveProjectProposal` with only one argument) — expected until Task 11.

- [ ] **Step 3: Commit**

```bash
git add src/features/approval-action.ts
git commit -m "feat: require total_working_hours when approving a project proposal"
```

---

### Task 6: Allocation actions — remaining project hours

**Files:**
- Modify: `src/features/allocation-action.ts`

**Interfaces:**
- Consumes: nothing new (same file, same imports — `weeksBetween` already imported).
- Produces: new `getRemainingProjectHours(projectId: string): Promise<number>` from
  `@/features/allocation-action` — `total_working_hours` minus the sum, over that
  project's *approved* allocations, of `hours_per_week * weeksBetween(start_date, end_date
  ?? project.end_date)`, floored at 0. `createBulkAllocations`'s hours-per-QA computation
  is corrected to use the same "remaining" basis instead of the project's full
  `total_working_hours`, so a project can't be over-committed by combining single-QA and
  bulk assignment. Consumed by Task 13 (`AllocationForm`) and Task 14
  (`BulkAssignDialog`).

- [ ] **Step 1: Replace the `createBulkAllocations` function and add `getRemainingProjectHours`**

In `src/features/allocation-action.ts`, replace the body of `createBulkAllocations` (the
hours calculation only — role/user loop and everything else stays the same) and append
the new function after it:

```ts
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
    .select("approval_status, start_date, end_date, total_working_hours")
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
    .select("hours_per_week, start_date, end_date")
    .eq("project_id", parsed.data.project_id)
    .eq("approval_status", "approved");
  if (existingError) throw new Error(existingError.message);

  const committed = (existingAllocations ?? []).reduce(
    (sum, a) => sum + a.hours_per_week * weeksBetween(a.start_date, a.end_date ?? project.end_date!),
    0,
  );
  const remainingHours = Math.max(0, project.total_working_hours - committed);

  const weeks = weeksBetween(project.start_date, project.end_date);
  const hoursPerWeek = remainingHours / parsed.data.user_ids.length / weeks;
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
      hours_per_week: hoursPerWeek,
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

/**
 * `total_working_hours` minus what's already committed to this project by
 * its own *approved* allocations (each converted to a total-hours figure via
 * `hours_per_week * weeksBetween(start, end ?? project.end_date)` — every
 * project has a required `end_date` since v2, so an open-ended allocation
 * always has a concrete fallback bound). Floored at 0.
 */
export async function getRemainingProjectHours(projectId: string): Promise<number> {
  const supabase = await createClient();

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("total_working_hours, end_date")
    .eq("id", projectId)
    .single();
  if (projectError || !project) throw new Error(projectError?.message ?? "Item not found");

  const { data: allocations, error } = await supabase
    .from("allocations")
    .select("hours_per_week, start_date, end_date")
    .eq("project_id", projectId)
    .eq("approval_status", "approved");
  if (error) throw new Error(error.message);

  const committed = (allocations ?? []).reduce(
    (sum, a) => sum + a.hours_per_week * weeksBetween(a.start_date, a.end_date ?? project.end_date!),
    0,
  );

  return Math.max(0, project.total_working_hours - committed);
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit` — expected error set unchanged from Task 5 (this task's own file
is clean).
Run: `npx eslint src/features/allocation-action.ts`
Expected: zero errors/warnings.

- [ ] **Step 3: Commit**

```bash
git add src/features/allocation-action.ts
git commit -m "feat: base bulk-assign split and add getRemainingProjectHours on remaining (not total) hours"
```

---

### Task 7: Dashboard action — product demand aggregation + monthly calendar data

**Files:**
- Modify: `src/features/dashboard-action.ts`

**Interfaces:**
- Consumes: `monthRange` (v1 `@/lib/load`, already imported).
- Produces: `WeeklyDashboard.topDemand` is replaced by `demandByProduct: { productId:
  string; hours: number }[]` (all products with nonzero hours, sorted desc — computed in
  both `getWeeklyDashboard` and `getRangeDashboard`, same shared return type as before).
  New `getProjectsForMonth(year: number, monthIndex0: number): Promise<Project[]>` —
  approved items overlapping the given month. `getMonthlyDashboard`,
  `MonthlyMemberRow`, and `MonthlyProjectRow` are removed (their only consumer, the
  "Monthly Hours per QA Member"/"Monthly Demand per Project" cards, is removed in Task
  10). Consumed starting Task 8 (pie chart), Task 9 (calendar), and Task 10 (dashboard
  page).

- [ ] **Step 1: Replace `src/features/dashboard-action.ts`**

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import {
  isoWeekRange,
  monthRange,
  weeklyHoursForUser,
  weeklyLoadPercent,
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
  demandByProduct: { productId: string; hours: number }[];
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

  const hoursByProductId = new Map<string, number>();
  for (const project of projects) {
    const hours = hoursByProject.get(project.id) ?? 0;
    hoursByProductId.set(project.product_id, (hoursByProductId.get(project.product_id) ?? 0) + hours);
  }
  const demandByProduct = [...hoursByProductId.entries()]
    .map(([productId, hours]) => ({ productId, hours }))
    .sort((a, b) => b.hours - a.hours);

  return {
    totalCapacity,
    totalAllocated,
    availableCapacity: totalCapacity - totalAllocated,
    resourceLoad,
    demandByProduct,
  };
}

/**
 * Same shape as `getWeeklyDashboard`, but for an arbitrary [start, end] range
 * instead of one fixed ISO week — `allocatedHours` per QA (and `hours` per
 * product in `demandByProduct`) is the range's total prorated hours divided
 * by how many weeks the range spans, i.e. an average hrs/week figure, so the
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

  const hoursByProductId = new Map<string, number>();
  for (const project of projects) {
    const hours = rangeHoursForProject(allocations, project.id, range) / weeks;
    hoursByProductId.set(project.product_id, (hoursByProductId.get(project.product_id) ?? 0) + hours);
  }
  const demandByProduct = [...hoursByProductId.entries()]
    .map(([productId, hours]) => ({ productId, hours }))
    .sort((a, b) => b.hours - a.hours);

  return {
    totalCapacity,
    totalAllocated,
    availableCapacity: totalCapacity - totalAllocated,
    resourceLoad,
    demandByProduct,
  };
}

/** Approved work items overlapping the given month, for the Dashboard's calendar view. */
export async function getProjectsForMonth(year: number, monthIndex0: number): Promise<Project[]> {
  const month = monthRange(year, monthIndex0);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("approval_status", "approved")
    .lte("start_date", month.end)
    .or(`end_date.is.null,end_date.gte.${month.start}`);
  if (error) throw new Error(error.message);
  return (data ?? []) as Project[];
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: `src/features/dashboard-action.ts` has zero errors on its own;
`src/components/dashboard/dashboard-page-content.tsx` now shows *new* errors (it still
references `getMonthlyDashboard`/`weekly.topDemand`) — expected until Task 10.

- [ ] **Step 3: Commit**

```bash
git add src/features/dashboard-action.ts
git commit -m "feat: aggregate weekly/range demand by product; add getProjectsForMonth"
```

---

### Task 8: Dashboard UI — product demand pie chart

**Files:**
- Create: `src/components/dashboard/product-demand-pie-chart.tsx` (via `npm install recharts` first)

**Interfaces:**
- Consumes: `demandByProduct` shape from Task 7 (`{ productId: string; hours: number }[]`).
- Produces: `ProductDemandPieChart` from `@/components/dashboard/product-demand-pie-chart`, consumed by Task 10 (dashboard page).

- [ ] **Step 1: Install recharts**

Run: `npm install recharts`
Expected: adds `recharts` to `package.json`/`package-lock.json`; this is the first
charting library in the repo.

- [ ] **Step 2: Write `src/components/dashboard/product-demand-pie-chart.tsx`**

```tsx
"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];

type ProductDemandPieChartProps = {
  data: { productId: string; hours: number }[];
  productNameById: Map<string, string>;
};

export function ProductDemandPieChart({ data, productNameById }: ProductDemandPieChartProps) {
  const top5 = data.slice(0, 5);
  const otherHours = data.slice(5).reduce((sum, d) => sum + d.hours, 0);

  const slices = [
    ...top5.map((d) => ({
      name: productNameById.get(d.productId) ?? "—",
      hours: Math.round(d.hours * 100) / 100,
    })),
    ...(otherHours > 0 ? [{ name: "Other", hours: Math.round(otherHours * 100) / 100 }] : []),
  ];

  if (slices.length === 0) {
    return <p className="text-sm text-muted-foreground">No allocated projects this week.</p>;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={slices} dataKey="hours" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
            {slices.map((slice, index) => (
              <Cell key={slice.name} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => `${value} hrs`} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` — expected error set unchanged from Task 7 (this task's own file
is clean; recharts ships its own TypeScript types, no `@types` package needed).
Run: `npx eslint src/components/dashboard/product-demand-pie-chart.tsx`
Expected: zero errors/warnings.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/product-demand-pie-chart.tsx package.json package-lock.json
git commit -m "feat: add product demand pie chart"
```

---

### Task 9: Dashboard UI — monthly project calendar

**Files:**
- Create: `src/components/dashboard/month-calendar.tsx`

**Interfaces:**
- Consumes: `buildCalendarGrid`/`packWeekBars`/`CalendarBar` (Task 2), `Project` (Task 2), `formatDate` (v1 `@/lib/format`).
- Produces: `MonthCalendar` from `@/components/dashboard/month-calendar`, consumed by Task 10 (dashboard page).

- [ ] **Step 1: Write `src/components/dashboard/month-calendar.tsx`**

```tsx
"use client";

import { buildCalendarGrid, packWeekBars } from "@/lib/calendar";
import { formatDate } from "@/lib/format";
import type { Project } from "@/lib/project";

const MAX_LANES = 3;
const BAR_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-pink-500",
  "bg-lime-600",
];

function colorForProject(projectId: string): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) hash = (hash + projectId.charCodeAt(i)) % BAR_COLORS.length;
  return BAR_COLORS[hash];
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type MonthCalendarProps = {
  year: number;
  monthIndex0: number;
  projects: Project[];
};

export function MonthCalendar({ year, monthIndex0, projects }: MonthCalendarProps) {
  const weeks = buildCalendarGrid(year, monthIndex0);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const rowTemplate = `1.5rem repeat(${MAX_LANES}, 1.25rem) 1rem`;

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="grid grid-cols-7 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-2 py-1.5">
            {label}
          </div>
        ))}
      </div>

      {weeks.map((week, weekIndex) => {
        const bars = packWeekBars(week, projects);
        const visibleBars = bars.filter((b) => b.lane < MAX_LANES);
        const hiddenCount = bars.length - visibleBars.length;

        return (
          <div
            key={weekIndex}
            className="relative grid grid-cols-7 border-b last:border-b-0"
            style={{ gridTemplateRows: rowTemplate }}
          >
            {week.map((_, dayIndex) => (
              <div
                key={`border-${dayIndex}`}
                className="border-r last:border-r-0"
                style={{ gridColumn: dayIndex + 1, gridRow: "1 / -1" }}
              />
            ))}

            {week.map((day, dayIndex) => (
              <div
                key={day.date}
                className={`px-1.5 pt-1 text-xs ${day.inCurrentMonth ? "" : "text-muted-foreground/40"}`}
                style={{ gridColumn: dayIndex + 1, gridRow: 1 }}
              >
                {Number(day.date.slice(8, 10))}
              </div>
            ))}

            {visibleBars.map((bar) => {
              const project = projectById.get(bar.projectId);
              if (!project) return null;
              return (
                <div
                  key={bar.projectId}
                  title={`${project.name} (${formatDate(project.start_date)} – ${
                    project.end_date ? formatDate(project.end_date) : "Ongoing"
                  })`}
                  className={`mx-0.5 mt-0.5 truncate rounded px-1 text-[10px] leading-4 text-white ${colorForProject(bar.projectId)}`}
                  style={{ gridColumn: `${bar.startCol + 1} / ${bar.endCol + 2}`, gridRow: bar.lane + 2 }}
                >
                  {project.name}
                </div>
              );
            })}

            {hiddenCount > 0 && (
              <div
                className="col-span-7 px-1.5 text-[10px] text-muted-foreground"
                style={{ gridColumn: "1 / -1", gridRow: MAX_LANES + 2 }}
              >
                +{hiddenCount} more
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit` — expected error set unchanged from Task 8 (this task's own file
is clean).
Run: `npx eslint src/components/dashboard/month-calendar.tsx`
Expected: zero errors/warnings.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/month-calendar.tsx
git commit -m "feat: add monthly project calendar view"
```

---

### Task 10: Dashboard page — wire the redesign together

**Files:**
- Modify: `src/components/dashboard/dashboard-page-content.tsx`

**Interfaces:**
- Consumes: `getWeeklyDashboard`/`getProjectsForMonth` (Task 7), `ProductDemandPieChart` (Task 8), `MonthCalendar` (Task 9), `getQaGroups` (v3), `getProducts` (v3).
- Produces: nothing consumed elsewhere (leaf feature). Fully replaces the previous
  4-summary-card + Capacity-by-QA-Group table + Resource Load list + Top Product Demand
  list + two Monthly cards layout.

- [ ] **Step 1: Replace `src/components/dashboard/dashboard-page-content.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadBar } from "@/components/ui/load-bar";
import { MonthCalendar } from "@/components/dashboard/month-calendar";
import { ProductDemandPieChart } from "@/components/dashboard/product-demand-pie-chart";
import { getProjectsForMonth, getWeeklyDashboard } from "@/features/dashboard-action";
import { getProducts } from "@/features/product-action";
import { getQaGroups } from "@/features/qa-group-action";
import { isoWeekRange } from "@/lib/load";

function mondayOf(date: Date): string {
  return isoWeekRange(date).start;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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

  const { data: monthProjects, isLoading: monthLoading } = useQuery({
    queryKey: ["projects-for-month", year, monthIndex0],
    queryFn: () => getProjectsForMonth(year, monthIndex0),
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

  const groupSections = (qaGroups ?? []).map((group) => {
    const members = resourceLoad.filter((r) => r.profile.qa_group_id === group.id);
    const totalCapacity = members.reduce((sum, r) => sum + r.profile.capacity_hours, 0);
    const totalAllocated = members.reduce((sum, r) => sum + r.allocatedHours, 0);
    const avgAvailable =
      members.length > 0 ? members.reduce((sum, r) => sum + (100 - r.loadPercent), 0) / members.length : 0;
    return { id: group.id, name: group.name, members, totalCapacity, totalAllocated, avgAvailable };
  });
  const unassignedMembers = resourceLoad.filter((r) => r.profile.qa_group_id === null);
  if (unassignedMembers.length > 0) {
    const totalCapacity = unassignedMembers.reduce((sum, r) => sum + r.profile.capacity_hours, 0);
    const totalAllocated = unassignedMembers.reduce((sum, r) => sum + r.allocatedHours, 0);
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
              {round2(weekly?.totalAllocated ?? 0)} <span className="text-sm font-normal text-muted-foreground">hrs/wk</span>
            </p>
            <LoadBar percent={allocatedPercent} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-6">
            <p className="text-xs font-medium uppercase text-muted-foreground">Available Capacity</p>
            <p className="text-3xl font-bold tabular-nums">
              {round2(weekly?.availableCapacity ?? 0)}{" "}
              <span className="text-sm font-normal text-muted-foreground">hrs/wk</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-6">
            <p className="text-xs font-medium uppercase text-muted-foreground">Total Number of Testers</p>
            <p className="text-3xl font-bold tabular-nums">{resourceLoad.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-5 pt-6">
            <h2 className="text-lg font-semibold">Capacity by QA Group</h2>
            {weeklyLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              groupSections.map((group) => (
                <div key={group.id} className="space-y-2">
                  <h3 className="text-xs font-medium uppercase text-muted-foreground">
                    {group.name} — {group.members.length} QA{group.members.length === 1 ? "" : "s"} ·{" "}
                    {round2(group.totalAllocated)}/{group.totalCapacity} hrs · {Math.round(group.avgAvailable)}% avail
                  </h3>
                  <div className="space-y-2">
                    {group.members.map((row) => (
                      <div key={row.profile.id} className="flex items-center gap-3">
                        <span className="w-32 truncate text-sm font-medium">{row.profile.name}</span>
                        <span className="w-24 text-xs text-muted-foreground">
                          {round2(row.allocatedHours)}/{row.profile.capacity_hours} hrs
                        </span>
                        <LoadBar percent={row.loadPercent} className="flex-1" />
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-4 text-lg font-semibold">Product Demand</h2>
            {weeklyLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <ProductDemandPieChart data={weekly?.demandByProduct ?? []} productNameById={productNameById} />
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

      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-4 text-lg font-semibold">Ongoing Projects This Month</h2>
          {monthLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <MonthCalendar year={year} monthIndex0={monthIndex0} projects={monthProjects ?? []} />
          )}
        </CardContent>
      </Card>
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

Open `/dashboard`. Confirm the summary row now shows 4 cards ending in "Total Number of
Testers" (no "Avg Available Capacity"). Confirm "Total Allocated"/"Available Capacity"
show up to 2 decimal places. Confirm the merged "Capacity by QA Group" card shows a
summary line per group followed by each member's LoadBar row, with an "Unassigned"
section if applicable. Confirm "Product Demand" renders a pie chart (not a list) with a
legend and hover tooltips showing hours. Confirm the old "Monthly Hours per QA Member"
and "Monthly Demand per Project" cards are gone, replaced by "Ongoing Projects This
Month" — a calendar grid where existing approved projects appear as colored bars spanning
their date range, changing the month picker updates it, and a week with more than 3
overlapping items shows a "+N more" note.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/dashboard-page-content.tsx
git commit -m "feat: redesign Resource Dashboard — merged cards, pie chart, monthly calendar"
```

---

### Task 11: Approvals UI — Total Working Hours input at approval

**Files:**
- Create: `src/components/approvals/project-proposal-card.tsx`
- Modify: `src/components/approvals/approvals-page-content.tsx`

**Interfaces:**
- Consumes: `approveProjectProposal` (Task 5, now takes `{ total_working_hours }`), `PendingProjectProposal` (v1 `@/features/approval-action`, already exported).
- Produces: `ProjectProposalCard` from `@/components/approvals/project-proposal-card`, consumed only by this task's page. No exports consumed by other tasks (leaf feature).

- [ ] **Step 1: Write `src/components/approvals/project-proposal-card.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PendingProjectProposal } from "@/features/approval-action";
import { formatDate } from "@/lib/format";

type ProjectProposalCardProps = {
  proposal: PendingProjectProposal;
  productName: string;
  onApprove: (totalWorkingHours: number) => void;
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
  const [hours, setHours] = useState("");
  const parsedHours = Number(hours);
  const canApprove = hours.trim() !== "" && parsedHours > 0;

  return (
    <div className="rounded-md border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{proposal.name}</span>
            <Badge variant="secondary">{productName}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {formatDate(proposal.start_date)} – {proposal.end_date ? formatDate(proposal.end_date) : "Ongoing"}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={`hours-${proposal.id}`} className="text-xs text-muted-foreground">
              Total Working Hours
            </Label>
            <Input
              id={`hours-${proposal.id}`}
              type="number"
              min={1}
              step={1}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="w-28"
            />
          </div>
          <Button size="sm" variant="outline" disabled={rejecting} onClick={onReject}>
            <X className="size-4" />
            Reject
          </Button>
          <Button size="sm" disabled={!canApprove || approving} onClick={() => onApprove(parsedHours)}>
            <Check className="size-4" />
            Approve
          </Button>
        </div>
      </div>

      <Table className="mt-4">
        <TableHeader>
          <TableRow>
            <TableHead>Role</TableHead>
            <TableHead className="text-right">Hours/Wk</TableHead>
            <TableHead>Timeline</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {proposal.allocations.map((allocation) => (
            <TableRow key={allocation.id}>
              <TableCell>{allocation.role_on_project}</TableCell>
              <TableCell className="text-right tabular-nums">{allocation.hours_per_week}</TableCell>
              <TableCell>
                {formatDate(allocation.start_date)} –{" "}
                {allocation.end_date ? formatDate(allocation.end_date) : "Ongoing"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Update `src/components/approvals/approvals-page-content.tsx`**

Full replacement — the "Project Proposals" card now renders `ProjectProposalCard`, and
`approveProjectMutation` takes `{ id, totalWorkingHours }`:

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProjectProposalCard } from "@/components/approvals/project-proposal-card";
import {
  approveAllocation,
  approveAllocationChange,
  approveProjectProposal,
  getPendingAllocationChanges,
  getPendingAllocationProposals,
  getPendingProjectProposals,
  rejectAllocation,
  rejectAllocationChange,
  rejectProjectProposal,
} from "@/features/approval-action";
import { getProducts } from "@/features/product-action";
import { getProjects } from "@/features/project-action";
import { formatDate } from "@/lib/format";

export function ApprovalsPageContent() {
  const queryClient = useQueryClient();

  const { data: proposals, isLoading: proposalsLoading } = useQuery({
    queryKey: ["approvals", "projects"],
    queryFn: () => getPendingProjectProposals(),
  });

  const { data: allocationProposals, isLoading: allocationsLoading } = useQuery({
    queryKey: ["approvals", "allocations"],
    queryFn: () => getPendingAllocationProposals(),
  });

  const { data: allocationChanges, isLoading: changesLoading } = useQuery({
    queryKey: ["approvals", "allocation-changes"],
    queryFn: () => getPendingAllocationChanges(),
  });

  const { data: approvedProjects } = useQuery({
    queryKey: ["projects", { approvalStatus: "approved" }],
    queryFn: () => getProjects({ approvalStatus: "approved" }),
  });
  const projectNameById = new Map((approvedProjects ?? []).map((p) => [p.id, p.name]));

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });
  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["approvals"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["allocations"] });
  }

  const approveProjectMutation = useMutation({
    mutationFn: ({ id, totalWorkingHours }: { id: string; totalWorkingHours: number }) =>
      approveProjectProposal(id, { total_working_hours: totalWorkingHours }),
    onSuccess: () => {
      toast.success("Project approved");
      invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rejectProjectMutation = useMutation({
    mutationFn: rejectProjectProposal,
    onSuccess: () => {
      toast.success("Project rejected");
      invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const approveAllocationMutation = useMutation({
    mutationFn: approveAllocation,
    onSuccess: () => {
      toast.success("Assignment approved");
      invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rejectAllocationMutation = useMutation({
    mutationFn: rejectAllocation,
    onSuccess: () => {
      toast.success("Assignment rejected");
      invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const approveChangeMutation = useMutation({
    mutationFn: approveAllocationChange,
    onSuccess: () => {
      toast.success("Rebaseline applied");
      invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rejectChangeMutation = useMutation({
    mutationFn: rejectAllocationChange,
    onSuccess: () => {
      toast.success("Rebaseline rejected");
      invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Review project proposals, future assignments, and rebaseline requests submitted by Project Managers.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project Proposals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {proposalsLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : !proposals || proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending project proposals.</p>
          ) : (
            proposals.map((proposal) => (
              <ProjectProposalCard
                key={proposal.id}
                proposal={proposal}
                productName={productNameById.get(proposal.product_id) ?? "—"}
                onApprove={(totalWorkingHours) =>
                  approveProjectMutation.mutate({ id: proposal.id, totalWorkingHours })
                }
                onReject={() => rejectProjectMutation.mutate(proposal.id)}
                approving={approveProjectMutation.isPending}
                rejecting={rejectProjectMutation.isPending}
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Future Assignment Proposals</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Project</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Hours/Wk</TableHead>
                <TableHead>Timeline</TableHead>
                <TableHead className="pr-6 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocationsLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : !allocationProposals || allocationProposals.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No pending assignment proposals.
                  </TableCell>
                </TableRow>
              ) : (
                allocationProposals.map((allocation) => (
                  <TableRow key={allocation.id}>
                    <TableCell className="pl-6">{projectNameById.get(allocation.project_id) ?? "—"}</TableCell>
                    <TableCell>{allocation.role_on_project}</TableCell>
                    <TableCell className="text-right tabular-nums">{allocation.hours_per_week}</TableCell>
                    <TableCell>
                      {formatDate(allocation.start_date)} – {allocation.end_date ? formatDate(allocation.end_date) : "Ongoing"}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={rejectAllocationMutation.isPending}
                          onClick={() => rejectAllocationMutation.mutate(allocation.id)}
                        >
                          <X className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          disabled={approveAllocationMutation.isPending}
                          onClick={() => approveAllocationMutation.mutate(allocation.id)}
                        >
                          <Check className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending Allocation Changes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {changesLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : !allocationChanges || allocationChanges.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending rebaseline requests.</p>
          ) : (
            allocationChanges.map((allocation) => (
              <div key={allocation.id} className="rounded-md border p-4">
                <div className="flex items-start justify-between gap-4">
                  <span className="font-medium">{projectNameById.get(allocation.project_id) ?? "—"}</span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={rejectChangeMutation.isPending}
                      onClick={() => rejectChangeMutation.mutate(allocation.id)}
                    >
                      <X className="size-4" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={approveChangeMutation.isPending}
                      onClick={() => approveChangeMutation.mutate(allocation.id)}
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
                      <TableHead className="text-right">Hours/Wk</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Timeline</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="text-sm text-muted-foreground">Current</TableCell>
                      <TableCell className="text-right tabular-nums">{allocation.hours_per_week}</TableCell>
                      <TableCell>{allocation.priority}</TableCell>
                      <TableCell>
                        {formatDate(allocation.start_date)} –{" "}
                        {allocation.end_date ? formatDate(allocation.end_date) : "Ongoing"}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-sm font-medium">Proposed</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {allocation.proposed_hours_per_week}
                      </TableCell>
                      <TableCell className="font-medium">{allocation.proposed_priority}</TableCell>
                      <TableCell className="font-medium">
                        {allocation.proposed_start_date ? formatDate(allocation.proposed_start_date) : "—"} –{" "}
                        {allocation.proposed_end_date ? formatDate(allocation.proposed_end_date) : "Ongoing"}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: zero errors in `src/components/approvals/*`.

Run: `npx eslint src/components/approvals`
Expected: zero errors/warnings.

- [ ] **Step 4: Manual smoke check**

As Project Manager, propose an item — confirm no Total Working Hours field appears. As QA
Lead on `/approvals`, confirm each pending proposal shows a "Total Working Hours" input
and Approve is disabled until a positive number is entered; approving saves that value
onto the item (check it on Project Portfolio afterward).

- [ ] **Step 5: Commit**

```bash
git add src/components/approvals/project-proposal-card.tsx src/components/approvals/approvals-page-content.tsx
git commit -m "feat: let QA Lead set Total Working Hours when approving a project proposal"
```

---

### Task 12: Project Portfolio UI — links, PM-hidden hours, no create-time progress

**Files:**
- Modify: `src/components/projects/project-form-dialog.tsx`
- Modify: `src/components/projects/propose-project-dialog.tsx`
- Modify: `src/components/projects/project-table.tsx`

**Interfaces:**
- Consumes: updated `createProject`/`updateProject`/`proposeProject` (Task 4), `Project.jira_link`/`jiva_link` (Task 2).
- Produces: the `/projects` route fully updated for v4. No exports consumed by other tasks (leaf feature).

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
        total_working_hours: String(project.total_working_hours),
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
        total_working_hours: "",
        priority: "medium",
        jira_link: "",
        jiva_link: "",
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
        jira_link: form.jira_link,
        jiva_link: form.jiva_link,
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="jira_link">JIRA Link</Label>
              <Input
                id="jira_link"
                type="url"
                placeholder="https://..."
                value={form.jira_link}
                onChange={(e) => setForm((f) => ({ ...f, jira_link: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="jiva_link">Jiva Link</Label>
              <Input
                id="jiva_link"
                type="url"
                placeholder="https://..."
                value={form.jiva_link}
                onChange={(e) => setForm((f) => ({ ...f, jiva_link: e.target.value }))}
                required
              />
            </div>
          </div>

          {isEdit && form.status !== "completed" && (
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

Note: for **create** mode, `progress_percent` stays `"0"` in `FormState`'s default and is
submitted unchanged — the input is simply never rendered when `!isEdit`, so a new item
always saves at 0% without the user seeing or touching that field.

- [ ] **Step 2: Replace `src/components/projects/propose-project-dialog.tsx`**

Total Working Hours field and its `totalWorkingHours` state are removed entirely (the
project payload sent to `proposeProject` simply omits `total_working_hours`, matching the
now-optional schema field); JIRA/Jiva link fields are added, still required for PMs too:

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
  const [priority, setPriority] = useState<Priority>("medium");
  const [jiraLink, setJiraLink] = useState("");
  const [jivaLink, setJivaLink] = useState("");
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
          priority,
          jira_link: jiraLink,
          jiva_link: jivaLink,
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
      setJiraLink("");
      setJivaLink("");
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

- [ ] **Step 3: Update `src/components/projects/project-table.tsx`**

Add a "Links" column between "Assigned" and "Actions" showing small JIRA/Jiva link
buttons when present. Changes only (full file still shown, since the column-count
constant and header/skeleton/body rows all need the extra column):

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, MoreHorizontal, Pencil, Trash2, Undo2 } from "lucide-react";
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
  const columnCount = showActions ? 11 : 10;

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
              <TableHead>Links</TableHead>
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
                  <TableCell>
                    <div className="flex gap-1">
                      {project.jira_link && (
                        <Button variant="ghost" size="sm" className="h-auto gap-1 p-0 text-xs" asChild>
                          <a href={project.jira_link} target="_blank" rel="noopener noreferrer">
                            JIRA <ExternalLink className="size-3" />
                          </a>
                        </Button>
                      )}
                      {project.jiva_link && (
                        <Button variant="ghost" size="sm" className="h-auto gap-1 p-0 text-xs" asChild>
                          <a href={project.jiva_link} target="_blank" rel="noopener noreferrer">
                            Jiva <ExternalLink className="size-3" />
                          </a>
                        </Button>
                      )}
                    </div>
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

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors in `src/components/projects/*`.

Run: `npx eslint src/components/projects`
Expected: zero errors/warnings.

- [ ] **Step 5: Manual smoke check**

As QA Lead: "New Item" dialog no longer shows a Progress field, requires JIRA/Jiva links
(valid URLs), and Edit still shows Progress (locked at 100% once Completed). As Project
Manager: "Propose Item" no longer shows Total Working Hours, still requires JIRA/Jiva
links. On the table, confirm JIRA/Jiva link buttons open the right URL in a new tab, and
are hidden (not blank buttons) for older items that predate this migration.

- [ ] **Step 6: Commit**

```bash
git add src/components/projects/project-form-dialog.tsx src/components/projects/propose-project-dialog.tsx src/components/projects/project-table.tsx
git commit -m "feat: add JIRA/Jiva links, hide PM total hours, remove create-time progress field"
```

---

### Task 13: Allocation Tool UI — dates-drive-hours in AllocationForm

**Files:**
- Modify: `src/components/allocations/allocation-form.tsx`

**Interfaces:**
- Consumes: `getRemainingProjectHours` (Task 6), `weeksBetween` (v2 `@/lib/load`, already used client-side elsewhere e.g. `BulkAssignDialog`).
- Produces: same exported `AllocationForm` component/props as v1–v3 — no signature change, purely internal behavior. Consumed unchanged by `allocations-page-content.tsx` (no edit needed there).

- [ ] **Step 1: Replace `src/components/allocations/allocation-form.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createAllocation, getRemainingProjectHours } from "@/features/allocation-action";
import { weeksBetween } from "@/lib/load";
import type { Priority, Project } from "@/lib/project";
import type { ProfileRole } from "@/lib/profile";

type AllocationFormProps = {
  userId: string;
  userName: string;
  capacityHours: number;
  allocatedHours: number;
  projects: Project[];
  role: ProfileRole;
};

export function AllocationForm({ userId, userName, capacityHours, allocatedHours, projects, role }: AllocationFormProps) {
  const [projectId, setProjectId] = useState("");
  const [roleOnProject, setRoleOnProject] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const queryClient = useQueryClient();

  const selectedProject = projects.find((p) => p.id === projectId) ?? null;

  const { data: remainingHours } = useQuery({
    queryKey: ["remaining-project-hours", projectId],
    queryFn: () => getRemainingProjectHours(projectId),
    enabled: projectId !== "",
  });

  function handleProjectChange(value: string) {
    setProjectId(value);
    const project = projects.find((p) => p.id === value);
    setStartDate(project?.start_date ?? "");
    setEndDate(project?.end_date ?? "");
  }

  const remainingCapacity = Math.max(0, capacityHours - allocatedHours);
  const validDates = startDate !== "" && endDate !== "" && endDate >= startDate;
  const weeks = validDates ? weeksBetween(startDate, endDate) : null;
  const computedHoursPerWeek = remainingHours !== undefined && weeks !== null ? remainingHours / weeks : null;
  const overCapacity = computedHoursPerWeek !== null && computedHoursPerWeek > remainingCapacity;
  const canSubmit =
    projectId !== "" && roleOnProject.trim() !== "" && computedHoursPerWeek !== null && computedHoursPerWeek > 0 && !overCapacity;

  const mutation = useMutation({
    mutationFn: () =>
      createAllocation({
        user_id: userId,
        project_id: projectId,
        role_on_project: roleOnProject,
        hours_per_week: computedHoursPerWeek!,
        start_date: startDate,
        end_date: endDate || undefined,
        priority,
      }),
    onSuccess: () => {
      toast.success(role === "qa_lead" ? "Resource assigned" : "Assignment proposed — pending QA Lead approval");
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["range-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", userId] });
      queryClient.invalidateQueries({ queryKey: ["remaining-project-hours", projectId] });
      setProjectId("");
      setRoleOnProject("");
      setStartDate("");
      setEndDate("");
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
          <span className="font-medium">{Math.round(remainingCapacity * 10) / 10} hrs / week</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="project">Target Project</Label>
        <Select value={projectId} onValueChange={handleProjectChange}>
          <SelectTrigger id="project" className="w-full">
            <SelectValue placeholder="Select a project..." />
          </SelectTrigger>
          <SelectContent>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedProject && (
          <p className="text-xs text-muted-foreground">
            Remaining hours for this item:{" "}
            {remainingHours !== undefined ? `${Math.round(remainingHours * 10) / 10} hrs` : "..."}
          </p>
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

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="start_date">Start</Label>
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
        <div className="space-y-2">
          <Label htmlFor="end_date">End</Label>
          <Input
            id="end_date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            min={selectedProject?.start_date}
            max={selectedProject?.end_date ?? undefined}
            required
            disabled={!projectId}
          />
        </div>
      </div>

      {startDate !== "" && endDate !== "" && endDate < startDate && (
        <p className="text-sm text-rose-600">End date must be on or after start date.</p>
      )}

      {computedHoursPerWeek !== null && (
        <p className={`text-sm ${overCapacity ? "text-rose-600" : "text-muted-foreground"}`}>
          This will allocate ~{Math.round(computedHoursPerWeek * 10) / 10} hrs/week.
          {overCapacity &&
            ` This QA only has ${Math.round(remainingCapacity * 10) / 10} hrs/week available — widen the date range or pick a different QA.`}
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

Note: `hours_per_week: computedHoursPerWeek!` — the non-null assertion is safe because
`canSubmit` (which gates whether `mutation.mutate()` can even be reached, via the
`disabled` prop on the submit button and the native `required` attributes blocking form
submission otherwise) already requires `computedHoursPerWeek !== null`.

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: zero errors in `src/components/allocations/allocation-form.tsx`.

Run: `npx eslint src/components/allocations/allocation-form.tsx`
Expected: zero errors/warnings.

- [ ] **Step 3: Manual smoke check**

On Allocation Tool, select a QA, then a project — confirm Start/End default to the
project's own dates and "Remaining hours for this item" appears. Confirm no "Allocated
Hours (Weekly)" field exists anymore. Narrow the date range — confirm the "This will
allocate ~X hrs/week" line updates live and increases as the range shrinks. Narrow it
enough to exceed the QA's remaining capacity — confirm the message turns red with an
explanation and Submit is disabled. Try picking a date outside the project's own
start/end — confirm the native date picker won't allow it (`min`/`max` clamping). Submit
a valid assignment — confirm it's created with the expected computed hours/week (cross-
check against the Assignments table).

- [ ] **Step 4: Commit**

```bash
git add src/components/allocations/allocation-form.tsx
git commit -m "feat: derive allocation hours/week from remaining project hours and picked dates"
```

---

### Task 14: Allocation Tool UI — BulkAssignDialog preview uses remaining hours

**Files:**
- Modify: `src/components/allocations/bulk-assign-dialog.tsx`

**Interfaces:**
- Consumes: `getRemainingProjectHours` (Task 6).
- Produces: same exported `BulkAssignDialog` — no prop/signature change, the live preview
  calculation now matches what `createBulkAllocations` (Task 6) actually computes
  server-side.

- [ ] **Step 1: Update the preview calculation in `src/components/allocations/bulk-assign-dialog.tsx`**

Replace the `previewHoursPerWeek` `useMemo` (which read `selectedProject.total_working_hours`
directly) with a query for the project's *remaining* hours, and derive the preview from
that instead:

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { createBulkAllocations, getRemainingProjectHours } from "@/features/allocation-action";
import { getAssignableProfiles } from "@/features/profile-action";
import { getProjects } from "@/features/project-action";
import { weeksBetween } from "@/lib/load";
import type { ProfileRole } from "@/lib/profile";

type BulkAssignDialogProps = {
  role: ProfileRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function BulkAssignDialog({ role, open, onOpenChange }: BulkAssignDialogProps) {
  const [projectId, setProjectId] = useState("");
  const [roleOnProject, setRoleOnProject] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const queryClient = useQueryClient();

  const { data: projects } = useQuery({
    queryKey: ["projects", { approvalStatus: "approved" }],
    queryFn: () => getProjects({ approvalStatus: "approved" }),
  });

  const { data: testers } = useQuery({
    queryKey: ["assignable-profiles"],
    queryFn: () => getAssignableProfiles(),
  });

  const selectedProject = (projects ?? []).find((p) => p.id === projectId) ?? null;

  const { data: remainingHours } = useQuery({
    queryKey: ["remaining-project-hours", projectId],
    queryFn: () => getRemainingProjectHours(projectId),
    enabled: projectId !== "",
  });

  const previewHoursPerWeek =
    selectedProject && selectedProject.end_date && remainingHours !== undefined && selectedUserIds.length > 0
      ? remainingHours / selectedUserIds.length / weeksBetween(selectedProject.start_date, selectedProject.end_date)
      : null;

  const mutation = useMutation({
    mutationFn: () =>
      createBulkAllocations({
        project_id: projectId,
        user_ids: selectedUserIds,
        role_on_project: roleOnProject,
      }),
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
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["range-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["allocations"] });
      queryClient.invalidateQueries({ queryKey: ["remaining-project-hours", projectId] });
      setProjectId("");
      setRoleOnProject("");
      setSelectedUserIds([]);
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function toggleUser(userId: string, checked: boolean) {
    setSelectedUserIds((current) => (checked ? [...current, userId] : current.filter((id) => id !== userId)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add project (even split)</DialogTitle>
          <DialogDescription>
            Remaining working hours are split evenly across the QA members you select.
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
            <Label htmlFor="bulk_project">Project / Activity</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="bulk_project" className="w-full">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {(projects ?? []).map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedProject && (
              <p className="text-xs text-muted-foreground">
                Remaining hours for this item:{" "}
                {remainingHours !== undefined ? `${Math.round(remainingHours * 10) / 10} hrs` : "..."}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="bulk_role">Role on Project</Label>
            <Input id="bulk_role" value={roleOnProject} onChange={(e) => setRoleOnProject(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label>QA Members</Label>
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
              {(testers ?? []).map((tester) => (
                <label key={tester.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selectedUserIds.includes(tester.id)}
                    onCheckedChange={(checked) => toggleUser(tester.id, checked === true)}
                  />
                  {tester.name}
                </label>
              ))}
            </div>
          </div>

          {previewHoursPerWeek !== null && (
            <p className="text-sm text-muted-foreground">
              Each selected QA gets ~{previewHoursPerWeek.toFixed(1)} hrs/week.
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={!projectId || selectedUserIds.length === 0 || mutation.isPending}>
              {mutation.isPending ? "Assigning..." : "Assign selected"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: zero errors project-wide (this resolves the last outstanding v4 file).

Run: `npx eslint src/components/allocations/bulk-assign-dialog.tsx`
Expected: zero errors/warnings.

- [ ] **Step 3: Manual smoke check**

Assign one QA to a project via the single-QA form (Task 13) first, consuming part of its
total hours. Then open "Add Project" for the same item — confirm "Remaining hours for
this item" reflects what's left (not the full total), and the even-split preview divides
that remaining amount, not the original total, across the newly selected QAs.

- [ ] **Step 4: Commit**

```bash
git add src/components/allocations/bulk-assign-dialog.tsx
git commit -m "fix: base bulk-assign preview on remaining project hours"
```

---

### Task 15: End-to-end manual verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Apply the migration**

Open the Supabase Dashboard SQL editor and run `supabase/migrations/0004_qa_resource_manager_v4.sql`
(Task 1) in full. Confirm no errors and `projects.jira_link`/`jiva_link` exist, both `''`
on existing rows.

- [ ] **Step 2: Full type-check, lint, and build pass**

Run: `npx tsc --noEmit` — zero errors.
Run: `npx eslint .` — zero errors/warnings.
Run: `npm run build` — production build succeeds.

- [ ] **Step 3: Dashboard (spec §1–4)**

Confirm the summary row shows exactly 4 cards ending in "Total Number of Testers", with
"Total Allocated"/"Available Capacity" displaying up to 2 decimals. Confirm the merged
"Capacity by QA Group" card shows a per-group summary line plus per-QA LoadBar rows, with
an "Unassigned" section when applicable. Confirm "Product Demand" is a pie chart
(hover shows exact hours; legend lists product names, not project names). Confirm the
month calendar shows colored bars for approved items spanning their actual date range,
correctly split across week rows for multi-week items, with a "+N more" note on any
week with more than 3 overlapping items; changing the month picker updates it.

- [ ] **Step 4: Project Portfolio (spec §5–7)**

As PM, propose an item — confirm no Total Working Hours field, and JIRA/Jiva links are
required (rejected if not a valid URL). As QA Lead on Approvals, confirm the Total
Working Hours input gates Approve and the value lands on the approved item. As QA Lead,
create a new item directly — confirm no Progress field appears, the item saves at 0%,
and Edit reveals Progress afterward. Confirm the Project Portfolio table's "Links" column
shows working JIRA/Jiva buttons only when set.

- [ ] **Step 5: Allocation Tool (spec §8)**

Assign a QA to a project via the single-QA form — confirm dates default to the project's
own range, "Remaining hours for this item" is shown and updates after submission, no
manual hours input exists, the live "~X hrs/week" preview tracks the picked date range,
over-capacity ranges are blocked with an inline error, and dates outside the project's
own bounds are unpickable. Then bulk-assign more QAs to the same item and confirm the
preview/actual split divides what's *left* of the total, not the full total again.

- [ ] **Step 6: Regression pass on v1–v3 flows**

Confirm nothing broke: Team Management CRUD, Project Portfolio approve/reject/complete
(including the v2 auto-complete allocation-release cascade and the v3 Assigned-QAs
dialog), rebaseline (QA-Lead-immediate and PM-staged), Approvals' other two sections
(Future Assignment Proposals, Pending Allocation Changes), Settings' QA
Groups/Products/Max-Parallel-Projects CRUD, and the Allocation Tool's date-range planning
period and QA-Group-sectioned resource picker (v3).

- [ ] **Step 7: Fix any issues found**

If any step above fails, fix the underlying code (not the check), re-run
`npx tsc --noEmit` and `npx eslint .`, and re-verify the specific failing step before
moving on. Do not commit broken intermediate states — squash the fix into a new commit
describing what was wrong.

---

## Self-Review

**Spec coverage** — every section of `docs/superpowers/specs/2026-08-11-qa-resource-manager-v4-design.md` maps to a task:
- §1 Summary row → Task 10
- §2 Merged QA-Group/Resource-Load card → Task 10
- §3 Product demand pie chart → Task 7 (`demandByProduct`), Task 8 (chart component), Task 10 (wiring)
- §4 Monthly calendar → Task 2 (`calendar.ts`), Task 7 (`getProjectsForMonth`), Task 9 (`MonthCalendar`), Task 10 (wiring)
- §5 PM-hidden Total Working Hours → Task 3 (schema), Task 4 (`proposeProject`), Task 5 (`approveProjectProposal`), Task 11 (Approvals UI), Task 12 (`ProposeProjectDialog`)
- §6 No create-time Progress → Task 12
- §7 JIRA/Jiva links → Task 1 (migration), Task 2 (type), Task 3 (schema), Task 4 (actions), Task 12 (UI)
- §8 Remaining hours + dates-drive-hours + BulkAssignDialog fix → Task 6 (`getRemainingProjectHours` + `createBulkAllocations` fix), Task 13 (`AllocationForm`), Task 14 (`BulkAssignDialog` preview)
- Out-of-scope items (day-level "+N more", drag/click-to-edit calendar bars, server-side re-validation of single-QA hours, a real product-vs-project remodel, PM-direct-create hours requirement) are correctly not implemented anywhere above.

**Placeholder scan** — no "TBD"/"TODO"/"similar to Task N" patterns anywhere in Tasks
1–15; every code block is a full, runnable replacement or addition; every step names its
exact verification command and expected result.

**Type consistency** — checked across tasks: `Project.jira_link`/`jiva_link` (Task 2)
match `ProjectInput` (Task 3), both action files (Task 4), and every UI consumer (Tasks
11, 12); `ProjectProposalProjectInput`'s `.partial({ total_working_hours: true })` (Task
3) matches `proposeProject`'s `?? 0` fallback (Task 4) and `ProposeProjectDialog`'s
omitted field (Task 12); `ApproveProjectProposalInput` (Task 3) matches
`approveProjectProposal`'s new second parameter (Task 5) and `ProjectProposalCard`'s
`onApprove` callback shape (Task 11); `WeeklyDashboard.demandByProduct` (Task 7) matches
`ProductDemandPieChart`'s `data` prop (Task 8) and the dashboard page's usage (Task 10);
`CalendarDay`/`CalendarWeek`/`CalendarBar`/`buildCalendarGrid`/`packWeekBars` (Task 2)
match `MonthCalendar`'s usage (Task 9) exactly; `getRemainingProjectHours` (Task 6)
matches its call sites in `AllocationForm` (Task 13) and `BulkAssignDialog` (Task 14),
and `createBulkAllocations`'s internal remaining-hours computation (Task 6) mirrors the
same formula so the client preview and server result agree.