# QA Resource Manager v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the v2 changes from `docs/superpowers/specs/2026-08-10-qa-resource-manager-v2-design.md` on top of the already-shipped v1 app: capacity governance (parallel-project limits, Settings page), richer allocation control (rebaseline with approval staging, bulk even-split assignment, per-allocation priority), three new work-item types, password reset, dashboard utilization bars, and an auto-complete cascade.

**Architecture:** Same conventions as v1 — `"use server"` action files per feature, Zod validation, TanStack React Query on the client, shadcn/ui, sonner toasts, service-role client for all writes. Most tasks below **replace the full content** of an existing v1 file rather than adding a new one; each task shows the complete new file, not a diff.

**Tech Stack:** Unchanged from v1 (Next.js 16.2.6, React 19.2.4, Supabase, TanStack Query 5, Zod 4, shadcn/ui, Tailwind 4).

## Global Constraints

- All INSERT/UPDATE/DELETE still go through `createAdminClient()`; all SELECT reads still go through the cookie-scoped `createClient()`. No change to this v1 rule.
- "Admin" in the spec means QA Lead — no new role is introduced anywhere in this plan.
- The max-parallel-projects check counts **distinct `project_id`s** among a QA's *approved* allocations whose date range overlaps the candidate range, across all four `item_type`s. It is a hard block (throws), unlike the load-% overallocation warning which stays visual-only.
- `total_working_hours`, `priority`, and `end_date`-required are enforced in Zod/the form, not as DB `NOT NULL` constraints (existing rows predate these fields) — see Task 1's migration notes.
- Weeks are ISO weeks (Monday–Sunday); date math throughout reuses the day-count conventions already established in `src/lib/load.ts` (inclusive day counts, UTC-anchored `T00:00:00Z` parsing).
- Verification per task: `npx tsc --noEmit`, `npx eslint <changed files>`, disposable `npx tsx` scratch scripts for pure-logic checks (deleted after use). No automated test framework, same as v1. Manual smoke checks use the browser via `mcp__claude-in-chrome__*` tools against `npm run dev`, signing in as the seeded QA Lead (and the Priya PM / Test Member accounts already in the database from v1's own verification) unless a task specifically needs a fresh account.
- Migrations are applied manually via the Supabase Dashboard SQL Editor, same as v1.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/0002_qa_resource_manager_v2.sql`

**Interfaces:**
- Consumes: `public.set_updated_at()` (already defined by v1's `0001_qa_resource_manager.sql`).
- Produces: table `public.app_settings` (singleton row, `id boolean primary key default true`, `max_parallel_projects integer`) and new columns on `public.projects` (`item_type`, `total_working_hours`, `priority`) and `public.allocations` (`priority`, `proposed_start_date`, `proposed_end_date`, `proposed_hours_per_week`, `proposed_priority`, `change_proposed_by`, `change_requested_at`) — every later task's types/queries depend on these exact names.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0002_qa_resource_manager_v2.sql`:

```sql
-- QA Resource Manager v2 — capacity governance, richer allocation control,
-- new work-item types, password reset support.
-- Run via Supabase Dashboard -> SQL Editor -> paste -> Run.

create table if not exists public.app_settings (
  id                     boolean primary key default true,
  max_parallel_projects  integer not null default 3 check (max_parallel_projects > 0),
  updated_at             timestamptz not null default timezone('utc', now()),
  constraint app_settings_singleton check (id)
);

insert into public.app_settings (id)
values (true)
on conflict (id) do nothing;

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;

create policy "Authenticated read" on public.app_settings
  for select using (auth.role() = 'authenticated');

alter table public.projects
  add column if not exists item_type text not null default 'project' check (item_type in
    ('project','support_testing','problem_incident','service_request')),
  add column if not exists total_working_hours numeric not null default 0 check (total_working_hours >= 0),
  add column if not exists priority text not null default 'medium' check (priority in
    ('low','medium','high','critical'));

alter table public.allocations
  add column if not exists priority text not null default 'medium' check (priority in
    ('low','medium','high','critical')),
  add column if not exists proposed_start_date date,
  add column if not exists proposed_end_date date,
  add column if not exists proposed_hours_per_week numeric check
    (proposed_hours_per_week is null or proposed_hours_per_week > 0),
  add column if not exists proposed_priority text check
    (proposed_priority is null or proposed_priority in ('low','medium','high','critical')),
  add column if not exists change_proposed_by uuid references public.profiles(id),
  add column if not exists change_requested_at timestamptz;

create index if not exists projects_item_type_idx on public.projects (item_type);
create index if not exists allocations_change_proposed_by_idx
  on public.allocations (change_proposed_by) where change_proposed_by is not null;
```

Note: `total_working_hours`, `priority`, and `end_date` are **not** made DB-mandatory here — existing v1 rows (e.g. "Mobile Banking Regression") have `total_working_hours = 0` and some have no `end_date`. Mandatory-ness for new/edited items is enforced entirely in the Zod schema (Task 4) and form (Task 8).

- [ ] **Step 2: Apply the migration**

Supabase Dashboard -> SQL Editor -> paste the full file contents -> Run.
Expected: no errors. Table Editor -> confirm `app_settings` exists with one row (`max_parallel_projects = 3`), and `projects`/`allocations` have the new columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0002_qa_resource_manager_v2.sql
git commit -m "feat: add v2 schema — app_settings, item types, priority, pending-change staging"
```

---

### Task 2: Shared type updates

**Files:**
- Modify: `src/lib/project.ts`
- Modify: `src/lib/allocation.ts`
- Create: `src/lib/settings.ts`

**Interfaces:**
- Consumes: nothing (pure types).
- Produces: `ItemType`, `Priority` (new, from `@/lib/project`), `Project` gains `item_type`/`total_working_hours`/`priority`; `Allocation` (from `@/lib/allocation`) gains `priority`/`proposed_start_date`/`proposed_end_date`/`proposed_hours_per_week`/`proposed_priority`/`change_proposed_by`/`change_requested_at`, plus a new `hasPendingChange(allocation): boolean` helper; `AppSettings` (new, from `@/lib/settings`). Consumed by every task from Task 3 onward.

- [ ] **Step 1: Update `src/lib/project.ts`**

```ts
export type Product = "qris_h2h" | "qris_bo" | "qrcb" | "pi" | "jv" | "ccw";

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
  product: Product;
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

- [ ] **Step 2: Update `src/lib/allocation.ts`**

```ts
import type { ApprovalStatus, Priority } from "@/lib/project";

export type Allocation = {
  id: string;
  user_id: string;
  project_id: string;
  role_on_project: string;
  hours_per_week: number;
  start_date: string;
  end_date: string | null;
  priority: Priority;
  approval_status: ApprovalStatus;
  proposed_by: string | null;
  proposed_start_date: string | null;
  proposed_end_date: string | null;
  proposed_hours_per_week: number | null;
  proposed_priority: Priority | null;
  change_proposed_by: string | null;
  change_requested_at: string | null;
  created_at: string;
  updated_at: string;
};

/** A row carrying a staged-but-not-yet-approved rebaseline request. */
export function hasPendingChange(allocation: Allocation): boolean {
  return allocation.proposed_start_date !== null;
}
```

- [ ] **Step 3: Write `src/lib/settings.ts`**

```ts
export type AppSettings = {
  max_parallel_projects: number;
};
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: errors in every file that constructs a `Project`/`Allocation` object without the new required fields (server actions, forms) — this is expected until later tasks update them. Confirm the error list only touches `src/features/project-action.ts`, `src/features/allocation-action.ts`, `src/features/approval-action.ts`, `src/features/dashboard-action.ts`, and the `src/components/projects/*` / `src/components/allocations/*` files — no errors outside those.

- [ ] **Step 5: Commit**

```bash
git add src/lib/project.ts src/lib/allocation.ts src/lib/settings.ts
git commit -m "feat: add v2 types — ItemType, Priority, AppSettings, pending-change fields"
```

---

### Task 3: Load calculation additions

**Files:**
- Modify: `src/lib/load.ts`

**Interfaces:**
- Consumes: nothing new (pure functions, same file as v1).
- Produces: `weeksBetween(startDate, endDate): number`, `rangesOverlap(a, b): boolean`, `overlappingProjectCount(allocations, userId, candidate, excludeProjectId?): number` from `@/lib/load`. `weeksBetween` is consumed by Task 9 (`createBulkAllocations`) and Task 12 (bulk-assign preview); `overlappingProjectCount` is consumed by Task 9 and Task 10 (the parallel-limit guard, both places).

- [ ] **Step 1: Add the new functions to `src/lib/load.ts`**

Append to the existing file (after `monthlyHoursForProject`, keeping everything already in the file unchanged):

```ts
/** Inclusive weeks spanned by [startDate, endDate]; always at least 1. */
export function weeksBetween(startDate: string, endDate: string): number {
  const days = Math.round((toUTCDate(endDate).getTime() - toUTCDate(startDate).getTime()) / MS_PER_DAY) + 1;
  return Math.max(1, days / 7);
}

export type DatedRange = { start_date: string; end_date: string | null };

/** Open-ended-aware overlap test for two arbitrary date intervals (not a fixed week/month). */
export function rangesOverlap(a: DatedRange, b: DatedRange): boolean {
  const aEnd = a.end_date ?? "9999-12-31";
  const bEnd = b.end_date ?? "9999-12-31";
  return a.start_date <= bEnd && b.start_date <= aEnd;
}

export type AllocationForOverlapCalc = DatedRange & { user_id: string; project_id: string };

/**
 * Distinct projects a user has an allocation on that overlaps `candidate`.
 * `excludeProjectId` avoids double-counting the same project the candidate
 * itself belongs to (e.g. two roles on one project shouldn't count as 2).
 */
export function overlappingProjectCount(
  allocations: AllocationForOverlapCalc[],
  userId: string,
  candidate: DatedRange,
  excludeProjectId?: string,
): number {
  const projectIds = new Set(
    allocations
      .filter((a) => a.user_id === userId && a.project_id !== excludeProjectId && rangesOverlap(a, candidate))
      .map((a) => a.project_id),
  );
  return projectIds.size;
}
```

- [ ] **Step 2: Write and run a scratch verification script**

Create `scratch-verify-load-v2.ts` at the repo root (temporary, not committed):

```ts
import { weeksBetween, rangesOverlap, overlappingProjectCount, type AllocationForOverlapCalc } from "@/lib/load";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  const same = typeof actual === "object" && actual !== null
    ? JSON.stringify(actual) === JSON.stringify(expected)
    : actual === expected;
  if (!same) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// weeksBetween: exactly 7 days (inclusive) -> 1 week.
assertEqual(weeksBetween("2026-08-01", "2026-08-07"), 1, "weeksBetween 7 days");
// 14 days -> 2 weeks.
assertEqual(weeksBetween("2026-08-01", "2026-08-14"), 2, "weeksBetween 14 days");
// 10 days -> fractional, not rounded.
assertEqual(Math.round(weeksBetween("2026-08-01", "2026-08-10") * 100) / 100, 1.43, "weeksBetween 10 days fractional");
// Same start/end (1 day) -> floor of 1 week, never less.
assertEqual(weeksBetween("2026-08-01", "2026-08-01"), 1, "weeksBetween same day floors to 1");

// rangesOverlap: both open-ended -> always overlap.
assertEqual(
  rangesOverlap({ start_date: "2026-01-01", end_date: null }, { start_date: "2030-01-01", end_date: null }),
  true,
  "rangesOverlap both open-ended",
);
// Non-overlapping closed ranges.
assertEqual(
  rangesOverlap({ start_date: "2026-01-01", end_date: "2026-01-31" }, { start_date: "2026-02-01", end_date: "2026-02-28" }),
  false,
  "rangesOverlap non-overlapping",
);
// Touching at a single day counts as overlap.
assertEqual(
  rangesOverlap({ start_date: "2026-01-01", end_date: "2026-01-31" }, { start_date: "2026-01-31", end_date: "2026-02-28" }),
  true,
  "rangesOverlap touching boundary",
);

const allocations: AllocationForOverlapCalc[] = [
  { user_id: "u1", project_id: "pA", start_date: "2026-01-01", end_date: "2026-06-30" },
  { user_id: "u1", project_id: "pB", start_date: "2026-03-01", end_date: null },
  { user_id: "u1", project_id: "pA", start_date: "2026-08-01", end_date: "2026-08-31" }, // same project pA again, later
  { user_id: "u2", project_id: "pC", start_date: "2026-01-01", end_date: "2026-12-31" },
];

// u1 overlapping mid-year: pA and pB both overlap April -> 2 distinct projects.
assertEqual(
  overlappingProjectCount(allocations, "u1", { start_date: "2026-04-01", end_date: "2026-04-30" }),
  2,
  "overlappingProjectCount counts distinct projects",
);
// Excluding pA (e.g. candidate itself is for pA) leaves only pB.
assertEqual(
  overlappingProjectCount(allocations, "u1", { start_date: "2026-04-01", end_date: "2026-04-30" }, "pA"),
  1,
  "overlappingProjectCount excludeProjectId",
);
// u2 has no overlap with u1's allocations, only counts their own.
assertEqual(
  overlappingProjectCount(allocations, "u2", { start_date: "2026-04-01", end_date: "2026-04-30" }),
  1,
  "overlappingProjectCount scoped to user",
);

console.log("OK: load.ts v2 additions pass all cases");
```

Run: `npx tsx scratch-verify-load-v2.ts`
Expected: prints `OK: load.ts v2 additions pass all cases`, exits 0.

- [ ] **Step 3: Delete the scratch script**

```bash
rm scratch-verify-load-v2.ts
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: same error set as Task 2 Step 4 (unrelated to this task's additions — `load.ts` itself has zero errors).

- [ ] **Step 5: Commit**

```bash
git add src/lib/load.ts
git commit -m "feat: add weeksBetween, rangesOverlap, and overlappingProjectCount helpers"
```

---

### Task 4: Zod schema updates

**Files:**
- Modify: `src/features/project-schema.ts`
- Modify: `src/features/allocation-schema.ts`
- Create: `src/features/settings-schema.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces: `ProjectInput` gains `item_type`/`total_working_hours`/`priority`, `end_date` becomes required (was `.optional()`); `AllocationInput` gains `priority`; new `AllocationChangeInput` (start/end/hours/priority, for rebaseline) and `BulkAllocationInput` (project_id/user_ids/role_on_project, for even-split) from `@/features/allocation-schema`; new `SettingsInput` from `@/features/settings-schema`. Consumed starting Task 5 (`SettingsInput`) and Task 7–9 (the rest).

- [ ] **Step 1: Update `src/features/project-schema.ts`**

```ts
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

export const ProjectInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  item_type: z.enum(["project", "support_testing", "problem_incident", "service_request"]),
  start_date: isoDate,
  end_date: isoDate,
  product: z.enum(["qris_h2h", "qris_bo", "qrcb", "pi", "jv", "ccw"]),
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

Note: `end_date` on `ProposedAllocationInput` (a *tester assignment* within a project proposal) stays optional — the mandatory-`end_date` rule from the spec is about the work item itself, not individual allocations.

- [ ] **Step 2: Update `src/features/allocation-schema.ts`**

```ts
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

export const AllocationInput = z.object({
  user_id: z.string().uuid("Select a tester"),
  project_id: z.string().uuid("Select a project"),
  role_on_project: z.string().trim().min(1, "Role on project is required"),
  hours_per_week: z.number().positive("Hours must be greater than 0"),
  start_date: isoDate,
  end_date: isoDate.optional(),
  priority: z.enum(["low", "medium", "high", "critical"]),
});
export type AllocationInput = z.infer<typeof AllocationInput>;

export const AllocationChangeInput = z.object({
  start_date: isoDate,
  end_date: isoDate.optional(),
  hours_per_week: z.number().positive("Hours must be greater than 0"),
  priority: z.enum(["low", "medium", "high", "critical"]),
});
export type AllocationChangeInput = z.infer<typeof AllocationChangeInput>;

export const BulkAllocationInput = z.object({
  project_id: z.string().uuid("Select a project"),
  user_ids: z.array(z.string().uuid()).min(1, "Select at least one QA member"),
  role_on_project: z.string().trim().min(1, "Role on project is required"),
});
export type BulkAllocationInput = z.infer<typeof BulkAllocationInput>;
```

- [ ] **Step 3: Write `src/features/settings-schema.ts`**

```ts
import { z } from "zod";

export const SettingsInput = z.object({
  max_parallel_projects: z.number().int().positive("Must be a positive whole number"),
});
export type SettingsInput = z.infer<typeof SettingsInput>;
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: the error set narrows — files that already pass the new required `ProjectInput`/`AllocationInput` fields through unchanged should now show fewer/different errors. This is a transitional state; full resolution happens by Task 13. Confirm no *new* error categories appear beyond "missing property" style errors in the action/UI files already flagged in Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/features/project-schema.ts src/features/allocation-schema.ts src/features/settings-schema.ts
git commit -m "feat: add v2 Zod schemas — item fields, allocation priority, rebaseline, bulk-assign, settings"
```

---

### Task 5: Settings feature (server actions, page, nav item)

**Files:**
- Create: `src/features/settings-action.ts`
- Create: `src/components/settings/settings-page-content.tsx`
- Create: `src/app/(app)/settings/page.tsx`
- Modify: `src/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: `SettingsInput` (Task 4), `AppSettings` (Task 2), `requireRole`/`getCurrentProfile` (v1 `@/lib/auth`).
- Produces: `getSettings(): Promise<AppSettings>`, `updateSettings(input: unknown): Promise<{ success: true }>` from `@/features/settings-action` — consumed by Task 9's and Task 10's parallel-limit guard, and by this task's own Settings page. The `/settings` route, QA-Lead-only.

- [ ] **Step 1: Write `src/features/settings-action.ts`**

```ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { SettingsInput } from "@/features/settings-schema";
import type { AppSettings } from "@/lib/settings";

export async function getSettings(): Promise<AppSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("max_parallel_projects")
    .eq("id", true)
    .single();
  if (error) throw new Error(error.message);
  return data as AppSettings;
}

export async function updateSettings(input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = SettingsInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("app_settings")
    .update({ max_parallel_projects: parsed.data.max_parallel_projects })
    .eq("id", true);

  if (error) throw new Error(error.message);
  return { success: true };
}
```

- [ ] **Step 2: Write the Settings page content**

`src/components/settings/settings-page-content.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSettings, updateSettings } from "@/features/settings-action";

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
    </div>
  );
}
```

- [ ] **Step 3: Write the route**

`src/app/(app)/settings/page.tsx`:

```tsx
import { redirect } from "next/navigation";

import { SettingsPageContent } from "@/components/settings/settings-page-content";
import { getCurrentProfile } from "@/lib/auth";

export default async function SettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "qa_lead") {
    redirect("/dashboard");
  }
  return <SettingsPageContent />;
}
```

- [ ] **Step 4: Add the nav item**

Update `src/components/app-sidebar.tsx` — add a `Settings` icon import and a new entry to `ITEMS`, QA-Lead-only, placed after Approvals:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CheckSquare,
  ClipboardList,
  LayoutDashboard,
  ListChecks,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { Profile, ProfileRole } from "@/lib/profile";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: ProfileRole[];
};

const ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Resource Dashboard",
    icon: LayoutDashboard,
    roles: ["qa_lead", "qa_member", "project_manager"],
  },
  {
    href: "/team",
    label: "Team Management",
    icon: Users,
    roles: ["qa_lead", "qa_member", "project_manager"],
  },
  {
    href: "/projects",
    label: "Project Portfolio",
    icon: ClipboardList,
    roles: ["qa_lead", "qa_member", "project_manager"],
  },
  {
    href: "/allocations",
    label: "Allocation Tool",
    icon: ListChecks,
    roles: ["qa_lead", "qa_member", "project_manager"],
  },
  {
    href: "/approvals",
    label: "Approvals",
    icon: CheckSquare,
    roles: ["qa_lead"],
  },
  {
    href: "/settings",
    label: "Settings",
    icon: SettingsIcon,
    roles: ["qa_lead"],
  },
];

export function AppSidebar({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const items = ITEMS.filter((item) => item.roles.includes(profile.role));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <LayoutDashboard className="size-4" />
          </div>
          <span className="text-base font-semibold tracking-tight text-white group-data-[collapsible=icon]:hidden">
            QA Resource Manager
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const Icon = item.icon;
                const active = pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link href={item.href}>
                        <Icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit` — expected error set unchanged from Task 4 (this task's own files are clean).
Run: `npx eslint src/features/settings-action.ts src/features/settings-schema.ts src/components/settings "src/app/(app)/settings" src/components/app-sidebar.tsx`
Expected: zero errors/warnings.

- [ ] **Step 6: Manual smoke check**

`npm run dev`, sign in as QA Lead, confirm a "Settings" nav item appears and `/settings` shows "Max Parallel Projects per QA" pre-filled with `3`. Change it to `5`, save, reload the page, confirm it now shows `5`. Sign in as QA Member or Project Manager, confirm no "Settings" nav item and `/settings` redirects to `/dashboard`.

- [ ] **Step 7: Commit**

```bash
git add src/features/settings-action.ts src/components/settings "src/app/(app)/settings" src/components/app-sidebar.tsx
git commit -m "feat: add Settings page for max-parallel-projects limit"
```

---

### Task 6: Team Management — password reset

**Files:**
- Modify: `src/features/profile-action.ts`
- Modify: `src/components/team/team-table.tsx`

**Interfaces:**
- Consumes: `createAdminClient`, `requireRole`, the existing `generateTempPassword()` helper (all already in `profile-action.ts`).
- Produces: `resetPassword(id: string): Promise<{ tempPassword: string }>` from `@/features/profile-action`, consumed only by this task's UI.

- [ ] **Step 1: Add `resetPassword` to `src/features/profile-action.ts`**

Add this function after `setProfileActive` (end of the file), leaving everything else in the file unchanged:

```ts
export async function resetPassword(id: string): Promise<{ tempPassword: string }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const tempPassword = generateTempPassword();

  const { error } = await admin.auth.admin.updateUserById(id, { password: tempPassword });
  if (error) throw new Error(error.message);

  return { tempPassword };
}
```

- [ ] **Step 2: Add the row action and reveal dialog to `src/components/team/team-table.tsx`**

Full replacement:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import type { Profile, ProfileRole, QaGroup } from "@/lib/profile";

const ROLE_LABEL: Record<ProfileRole, string> = {
  qa_lead: "QA Lead",
  qa_member: "QA Member",
  project_manager: "Project Manager",
};

const QA_GROUP_LABEL: Record<QaGroup, string> = {
  qris_h2h: "QRIS H2H",
  qris_bo: "QRIS BO",
  digital_h2h: "Digital H2H",
  digital_bo: "Digital BO",
  corporate_it: "Corporate IT",
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
                    {profile.qa_group ? QA_GROUP_LABEL[profile.qa_group] : "—"}
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

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` — same expected error set as Task 5 minus anything in `profile-action.ts`/`team-table.tsx` (both now clean).
Run: `npx eslint src/features/profile-action.ts src/components/team/team-table.tsx`
Expected: zero errors/warnings.

- [ ] **Step 4: Manual smoke check**

As QA Lead, on Team Management, open the row menu for "Test Member" -> Reset Password. Expected: a dialog shows a new temp password immediately (mutation fires on click, no separate confirm step). Close it, sign in as Test Member using the new password to confirm it actually works, then sign back in as QA Lead.

- [ ] **Step 5: Commit**

```bash
git add src/features/profile-action.ts src/components/team/team-table.tsx
git commit -m "feat: add password reset to Team Management"
```

---

### Task 7: Project Portfolio server actions v2

**Files:**
- Modify: `src/features/project-action.ts`

**Interfaces:**
- Consumes: updated `ProjectInput`/`ProjectProposalInput` (Task 4), `Project`/`ItemType`/`Priority` (Task 2).
- Produces: same exported function names as v1 (`getProjects`, `createProject`, `updateProject`, `deleteProject`, `proposeProject`, `withdrawProjectProposal`) but `createProject`/`updateProject`/`proposeProject` now read/write the three new columns, and `updateProject` triggers the auto-complete cascade whenever `status` is set to `"completed"`. Consumed starting Task 8.

- [ ] **Step 1: Replace `src/features/project-action.ts`**

```ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ProjectInput, ProjectProposalInput } from "@/features/project-schema";
import type { Product, Project, ProjectStatus, ApprovalStatus } from "@/lib/project";

export async function getProjects({
  status = "",
  product = "",
  search = "",
  approvalStatus,
}: {
  status?: ProjectStatus | "";
  product?: Product | "";
  search?: string;
  approvalStatus?: ApprovalStatus;
} = {}): Promise<Project[]> {
  const supabase = await createClient();

  let query = supabase.from("projects").select("*");

  const term = search.trim();
  if (term) query = query.ilike("name", `%${term}%`);
  if (status) query = query.eq("status", status);
  if (product) query = query.eq("product", product);
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
    product: parsed.data.product,
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
      product: parsed.data.product,
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
      product: parsed.data.project.product,
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

Note: `releaseAllocationsForCompletedProject` only fires from this file's `updateProject` (the QA-Lead-only edit path) — per the spec, PMs still can't edit approved projects at all, so there's no other path that could set `status = "completed"`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: `src/features/project-action.ts` no longer appears in the error list.

- [ ] **Step 3: Commit**

```bash
git add src/features/project-action.ts
git commit -m "feat: add item fields and auto-complete cascade to project actions"
```

---

### Task 8: Project Portfolio UI v2

**Files:**
- Modify: `src/components/projects/project-form-dialog.tsx`
- Modify: `src/components/projects/propose-project-dialog.tsx`
- Modify: `src/components/projects/project-table.tsx`
- Modify: `src/components/projects/projects-page-content.tsx`

**Interfaces:**
- Consumes: `createProject`/`updateProject`/`proposeProject` (Task 7), `ItemType`/`Priority`/`Project` (Task 2), `ProgressBar`/`Badge` (v1 `@/components/ui`).
- Produces: the `/projects` route fully updated for v2 — no exports consumed by other tasks (leaf feature).

- [ ] **Step 1: Replace `src/components/projects/project-form-dialog.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import type { ItemType, Priority, Product, Project, ProjectStatus } from "@/lib/project";

type FormState = {
  name: string;
  item_type: ItemType;
  start_date: string;
  end_date: string;
  product: Product;
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
        product: project.product,
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
        product: "qris_h2h",
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

  const mutation = useMutation<{ success: true }, Error, void>({
    mutationFn: () => {
      const payload = {
        name: form.name,
        item_type: form.item_type,
        start_date: form.start_date,
        end_date: form.end_date,
        product: form.product,
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
              <Select value={form.product} onValueChange={(value) => setForm((f) => ({ ...f, product: value as Product }))}>
                <SelectTrigger id="product" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qris_h2h">QRIS H2H</SelectItem>
                  <SelectItem value="qris_bo">QRIS BO</SelectItem>
                  <SelectItem value="qrcb">QRCB</SelectItem>
                  <SelectItem value="pi">PI</SelectItem>
                  <SelectItem value="jv">JV</SelectItem>
                  <SelectItem value="ccw">CCW</SelectItem>
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
            <Button type="submit" disabled={mutation.isPending}>
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
import { proposeProject } from "@/features/project-action";
import type { ItemType, Priority, Product, ProjectStatus } from "@/lib/project";

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
  const [product, setProduct] = useState<Product>("qris_h2h");
  const [status, setStatus] = useState<ProjectStatus>("to_do");
  const [totalWorkingHours, setTotalWorkingHours] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [rows, setRows] = useState<AllocationRow[]>([emptyAllocationRow()]);
  const queryClient = useQueryClient();

  const { data: testers } = useQuery({
    queryKey: ["assignable-profiles"],
    queryFn: () => getAssignableProfiles(),
  });

  const mutation = useMutation({
    mutationFn: () =>
      proposeProject({
        project: {
          name,
          item_type: itemType,
          start_date: startDate,
          end_date: endDate,
          product,
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
              <Select value={product} onValueChange={(value) => setProduct(value as Product)}>
                <SelectTrigger id="proposal_product" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qris_h2h">QRIS H2H</SelectItem>
                  <SelectItem value="qris_bo">QRIS BO</SelectItem>
                  <SelectItem value="qrcb">QRCB</SelectItem>
                  <SelectItem value="pi">PI</SelectItem>
                  <SelectItem value="jv">JV</SelectItem>
                  <SelectItem value="ccw">CCW</SelectItem>
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
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Submitting..." : "Submit proposal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Replace `src/components/projects/project-table.tsx`**

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
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { deleteProject, withdrawProjectProposal } from "@/features/project-action";
import { formatDate } from "@/lib/format";
import type { ItemType, Priority, Product, Project, ProjectStatus } from "@/lib/project";
import type { ProfileRole } from "@/lib/profile";

const PRODUCT_LABEL: Record<Product, string> = {
  qris_h2h: "QRIS H2H",
  qris_bo: "QRIS BO",
  qrcb: "QRCB",
  pi: "PI",
  jv: "JV",
  ccw: "CCW",
};

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
};

export function ProjectTable({ rows, isLoading, isError, role, currentProfileId }: ProjectTableProps) {
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const queryClient = useQueryClient();

  const canEdit = role === "qa_lead";
  const canPropose = role === "project_manager";
  const showActions = canEdit || canPropose;
  const columnCount = showActions ? 9 : 8;

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
                    <Badge variant="secondary">{PRODUCT_LABEL[project.product]}</Badge>
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

- [ ] **Step 4: Update `src/components/projects/projects-page-content.tsx`**

Full replacement (only the header text and button labels change from v1; filters/table wiring stay the same):

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
import { getProjects } from "@/features/project-action";
import type { Product, ProjectStatus } from "@/lib/project";
import type { ProfileRole } from "@/lib/profile";

export function ProjectsPageContent({ role, currentProfileId }: { role: ProfileRole; currentProfileId: string }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "">("");
  const [productFilter, setProductFilter] = useState<Product | "">("");
  const [createOpen, setCreateOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["projects", { search, status: statusFilter, product: productFilter }],
    queryFn: () => getProjects({ search, status: statusFilter, product: productFilter }),
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
        <Select value={productFilter || "all"} onValueChange={(v) => setProductFilter(v === "all" ? "" : (v as Product))}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Product" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Products</SelectItem>
            <SelectItem value="qris_h2h">QRIS H2H</SelectItem>
            <SelectItem value="qris_bo">QRIS BO</SelectItem>
            <SelectItem value="qrcb">QRCB</SelectItem>
            <SelectItem value="pi">PI</SelectItem>
            <SelectItem value="jv">JV</SelectItem>
            <SelectItem value="ccw">CCW</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ProjectTable rows={data ?? []} isLoading={isLoading} isError={isError} role={role} currentProfileId={currentProfileId} />

      {role === "qa_lead" && <ProjectFormDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />}
      {role === "project_manager" && <ProposeProjectDialog open={proposeOpen} onOpenChange={setProposeOpen} />}
    </div>
  );
}
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors in `src/components/projects/*`.

Run: `npx eslint src/components/projects`
Expected: zero errors/warnings.

- [ ] **Step 6: Manual smoke check**

As QA Lead: click "New Item", confirm the dialog shows Item Type/Total Working Hours/Priority fields and End Date is now required (form won't submit without it). Create a "Problem Incident" item. Confirm the table shows its Type/Priority/Total Hrs columns correctly. Edit an existing v1 project (e.g. "Mobile Banking Regression", which has `total_working_hours = 0` and possibly no end date from before this migration) — confirm the form loads without crashing and you can fill in the now-required fields and save. Set an item's Status to "Completed" and save; confirm the Progress field disappears from the form beforehand and the table shows 100% after saving. As Project Manager, click "Propose Item" and confirm the same new fields appear there too.

- [ ] **Step 7: Commit**

```bash
git add src/components/projects
git commit -m "feat: add item type, total hours, priority, and required end date to Project Portfolio"
```

---

### Task 9: Allocation Tool server actions v2

**Files:**
- Modify: `src/features/allocation-action.ts`

**Interfaces:**
- Consumes: `getSettings` (Task 5), `overlappingProjectCount`/`weeksBetween` (Task 3), `AllocationInput`/`AllocationChangeInput`/`BulkAllocationInput` (Task 4), `Allocation` (Task 2).
- Produces: `assertWithinParallelLimit(admin, userId, projectId, startDate, endDate, excludeAllocationId?): Promise<void>` (**exported** — the same limit guard is reused by Task 10's approval actions, not duplicated); `getAllocationsForUser` (unchanged from v1), `createAllocation`/`updateAllocation` (now also handle `priority` and enforce the limit), new `proposeAllocationChange(id, input): Promise<{ success: true }>` and `createBulkAllocations(input): Promise<{ created: string[]; failed: { userId: string; reason: string }[] }>`. Consumed starting Task 10 (the guard) and Task 11–13 (everything else).

- [ ] **Step 1: Replace `src/features/allocation-action.ts`**

```ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { getSettings } from "@/features/settings-action";
import {
  AllocationInput,
  AllocationChangeInput,
  BulkAllocationInput,
} from "@/features/allocation-schema";
import { overlappingProjectCount, weeksBetween } from "@/lib/load";
import type { Allocation } from "@/lib/allocation";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Hard-blocks an allocation/change/approval that would push a QA over
 * `app_settings.max_parallel_projects` distinct concurrent projects.
 * `excludeAllocationId` excludes the row being updated (from its own old
 * state) when re-checking an existing allocation; the candidate's own
 * `projectId` is always excluded from the count (assigning the same
 * project twice isn't "2 parallel projects").
 */
export async function assertWithinParallelLimit(
  admin: AdminClient,
  userId: string,
  projectId: string,
  startDate: string,
  endDate: string | null,
  excludeAllocationId?: string,
): Promise<void> {
  const settings = await getSettings();

  let query = admin
    .from("allocations")
    .select("id, project_id, start_date, end_date")
    .eq("user_id", userId)
    .eq("approval_status", "approved");
  if (excludeAllocationId) query = query.neq("id", excludeAllocationId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const existing = (data ?? []) as { project_id: string; start_date: string; end_date: string | null }[];
  const count = overlappingProjectCount(
    existing.map((a) => ({
      user_id: userId,
      project_id: a.project_id,
      start_date: a.start_date,
      end_date: a.end_date,
    })),
    userId,
    { start_date: startDate, end_date: endDate },
    projectId,
  );

  if (count + 1 > settings.max_parallel_projects) {
    throw new Error(
      `This would exceed the max of ${settings.max_parallel_projects} parallel projects for this QA.`,
    );
  }
}

export async function getAllocationsForUser(userId: string): Promise<Allocation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("allocations")
    .select("*")
    .eq("user_id", userId)
    .order("start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Allocation[];
}

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
    hours_per_week: parsed.data.hours_per_week,
    start_date: parsed.data.start_date,
    end_date: parsed.data.end_date ?? null,
    priority: parsed.data.priority,
    approval_status: isLead ? "approved" : "pending",
    proposed_by: isLead ? null : profile.id,
  });

  if (error) throw new Error(error.message);
  return { success: true };
}

export async function updateAllocation(id: string, input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = AllocationInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  await assertWithinParallelLimit(
    admin,
    parsed.data.user_id,
    parsed.data.project_id,
    parsed.data.start_date,
    parsed.data.end_date ?? null,
    id,
  );

  const { error } = await admin
    .from("allocations")
    .update({
      user_id: parsed.data.user_id,
      project_id: parsed.data.project_id,
      role_on_project: parsed.data.role_on_project,
      hours_per_week: parsed.data.hours_per_week,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date ?? null,
      priority: parsed.data.priority,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return { success: true };
}

export async function deleteAllocation(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error } = await admin.from("allocations").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function withdrawAllocationProposal(id: string): Promise<{ success: true }> {
  const profile = await requireRole(["project_manager"]);

  const admin = createAdminClient();
  const { data: allocation } = await admin
    .from("allocations")
    .select("proposed_by, approval_status")
    .eq("id", id)
    .single();

  if (!allocation || allocation.proposed_by !== profile.id || allocation.approval_status !== "pending") {
    throw new Error("This proposal can no longer be withdrawn");
  }

  const { error } = await admin.from("allocations").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}

/**
 * A Project Manager's request to change dates/hours/priority on an
 * already-approved allocation. Stages into `proposed_*` — never touches
 * the live columns directly. Blocked while another change is already
 * pending on the same row. A QA Lead's own rebaseline instead calls
 * `updateAllocation` directly (immediate, no staging) — see
 * `RebaselineDialog` in Task 11.
 */
export async function proposeAllocationChange(id: string, input: unknown): Promise<{ success: true }> {
  const profile = await requireRole(["project_manager"]);

  const parsed = AllocationChangeInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: allocation } = await admin
    .from("allocations")
    .select("approval_status, proposed_start_date")
    .eq("id", id)
    .single();

  if (!allocation || allocation.approval_status !== "approved") {
    throw new Error("Only an approved assignment can be rebaselined");
  }
  if (allocation.proposed_start_date !== null) {
    throw new Error("This assignment already has a pending change awaiting approval");
  }

  const { error } = await admin
    .from("allocations")
    .update({
      proposed_start_date: parsed.data.start_date,
      proposed_end_date: parsed.data.end_date ?? null,
      proposed_hours_per_week: parsed.data.hours_per_week,
      proposed_priority: parsed.data.priority,
      change_proposed_by: profile.id,
      change_requested_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return { success: true };
}

/**
 * Assigns one project/activity to several QAs at once, splitting its
 * `total_working_hours` evenly (per QA, per week, over the item's own
 * date range). Each QA gets an independent allocation row. QA-Lead
 * batches go live immediately (per-QA, subject to the parallel-limit
 * check); PM batches are standalone `pending` proposals, same rule as
 * the single-QA flow. Partial success is expected and reported —
 * one QA failing the limit check doesn't block the others.
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
    .select("approval_status, start_date, end_date, total_working_hours")
    .eq("id", parsed.data.project_id)
    .single();

  if (projectError || !project || project.approval_status !== "approved") {
    throw new Error("You can only assign testers to an approved project");
  }
  if (!project.end_date) {
    throw new Error("This item has no end date and can't be evenly split");
  }

  const weeks = weeksBetween(project.start_date, project.end_date);
  const hoursPerWeek = project.total_working_hours / parsed.data.user_ids.length / weeks;
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: `src/features/allocation-action.ts` no longer appears in the error list.

- [ ] **Step 3: Commit**

```bash
git add src/features/allocation-action.ts
git commit -m "feat: add parallel-limit guard, rebaseline staging, and bulk even-split assignment"
```

---

### Task 10: Approval server actions v2

**Files:**
- Modify: `src/features/approval-action.ts`

**Interfaces:**
- Consumes: `assertWithinParallelLimit` (Task 9, imported — not duplicated), `Allocation` (Task 2).
- Produces: same v1 exports (`getPendingProjectProposals`, `getPendingAllocationProposals`, `approveProjectProposal`, `rejectProjectProposal`, `approveAllocation`, `rejectAllocation`) now enforcing the parallel-limit at every approval point, plus new `getPendingAllocationChanges(): Promise<Allocation[]>`, `approveAllocationChange(id): Promise<{ success: true }>`, `rejectAllocationChange(id): Promise<{ success: true }>`. Consumed starting Task 14.

- [ ] **Step 1: Replace `src/features/approval-action.ts`**

```ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { assertWithinParallelLimit } from "@/features/allocation-action";
import type { Allocation } from "@/lib/allocation";
import type { Project } from "@/lib/project";

export type PendingProjectProposal = Project & { allocations: Allocation[] };

export async function getPendingProjectProposals(): Promise<PendingProjectProposal[]> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { data: projects, error } = await admin
    .from("projects")
    .select("*")
    .eq("approval_status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const proposals: PendingProjectProposal[] = [];
  for (const project of (projects ?? []) as Project[]) {
    const { data: allocations } = await admin.from("allocations").select("*").eq("project_id", project.id);
    proposals.push({ ...project, allocations: (allocations ?? []) as Allocation[] });
  }
  return proposals;
}

export async function getPendingAllocationProposals(): Promise<Allocation[]> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("allocations")
    .select("*, projects!inner(approval_status)")
    .eq("approval_status", "pending")
    .eq("projects.approval_status", "approved")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Allocation[];
}

export async function getPendingAllocationChanges(): Promise<Allocation[]> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("allocations")
    .select("*")
    .not("proposed_start_date", "is", null)
    .order("change_requested_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Allocation[];
}

export async function approveProjectProposal(projectId: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

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
    .update({ approval_status: "approved" })
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

export async function rejectProjectProposal(projectId: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error: projectError } = await admin
    .from("projects")
    .update({ approval_status: "rejected" })
    .eq("id", projectId);
  if (projectError) throw new Error(projectError.message);

  const { error: allocationsError } = await admin
    .from("allocations")
    .update({ approval_status: "rejected" })
    .eq("project_id", projectId)
    .eq("approval_status", "pending");
  if (allocationsError) throw new Error(allocationsError.message);

  return { success: true };
}

export async function approveAllocation(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();

  const { data: allocation, error: fetchError } = await admin
    .from("allocations")
    .select("user_id, project_id, start_date, end_date")
    .eq("id", id)
    .single();
  if (fetchError || !allocation) throw new Error(fetchError?.message ?? "Assignment not found");

  await assertWithinParallelLimit(
    admin,
    allocation.user_id,
    allocation.project_id,
    allocation.start_date,
    allocation.end_date,
    id,
  );

  const { error } = await admin.from("allocations").update({ approval_status: "approved" }).eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function rejectAllocation(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error } = await admin.from("allocations").update({ approval_status: "rejected" }).eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function approveAllocationChange(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();

  const { data: allocation, error: fetchError } = await admin
    .from("allocations")
    .select("user_id, project_id, proposed_start_date, proposed_end_date, proposed_hours_per_week, proposed_priority")
    .eq("id", id)
    .single();
  if (fetchError || !allocation || allocation.proposed_start_date === null) {
    throw new Error("This assignment has no pending change");
  }

  await assertWithinParallelLimit(
    admin,
    allocation.user_id,
    allocation.project_id,
    allocation.proposed_start_date,
    allocation.proposed_end_date,
    id,
  );

  const { error } = await admin
    .from("allocations")
    .update({
      start_date: allocation.proposed_start_date,
      end_date: allocation.proposed_end_date,
      hours_per_week: allocation.proposed_hours_per_week,
      priority: allocation.proposed_priority,
      proposed_start_date: null,
      proposed_end_date: null,
      proposed_hours_per_week: null,
      proposed_priority: null,
      change_proposed_by: null,
      change_requested_at: null,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return { success: true };
}

export async function rejectAllocationChange(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error } = await admin
    .from("allocations")
    .update({
      proposed_start_date: null,
      proposed_end_date: null,
      proposed_hours_per_week: null,
      proposed_priority: null,
      change_proposed_by: null,
      change_requested_at: null,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return { success: true };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors anywhere in the project — this is the last file that had outstanding v2-related errors from Tasks 2–4.

- [ ] **Step 3: Commit**

```bash
git add src/features/approval-action.ts
git commit -m "feat: enforce parallel-limit on approvals; add pending allocation change review"
```

---

### Task 11: Allocation Tool UI — priority field + Rebaseline dialog

**Files:**
- Modify: `src/components/allocations/allocation-form.tsx`
- Delete: `src/components/allocations/allocation-edit-dialog.tsx`
- Create: `src/components/allocations/rebaseline-dialog.tsx`

**Interfaces:**
- Consumes: `createAllocation` (Task 9, now takes `priority`), `updateAllocation`/`proposeAllocationChange` (Task 9), `Allocation`/`hasPendingChange` (Task 2), `Priority` (Task 2).
- Produces: `RebaselineDialog` from `@/components/allocations/rebaseline-dialog`, replacing v1's `AllocationEditDialog` — role-aware: QA Lead's submit calls `updateAllocation` (immediate), Project Manager's calls `proposeAllocationChange` (staged). Consumed by Task 13's `AssignmentsTable`.

- [ ] **Step 1: Add the Priority field to `src/components/allocations/allocation-form.tsx`**

Full replacement:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { createAllocation } from "@/features/allocation-action";
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
  const [hoursPerWeek, setHoursPerWeek] = useState("8");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      createAllocation({
        user_id: userId,
        project_id: projectId,
        role_on_project: roleOnProject,
        hours_per_week: Number(hoursPerWeek),
        start_date: startDate,
        end_date: endDate || undefined,
        priority,
      }),
    onSuccess: () => {
      toast.success(role === "qa_lead" ? "Resource assigned" : "Assignment proposed — pending QA Lead approval");
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", userId] });
      setProjectId("");
      setRoleOnProject("");
      setHoursPerWeek("8");
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
          <span className="font-medium">{Math.max(0, capacityHours - allocatedHours)} hrs / week</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="project">Target Project</Label>
        <Select value={projectId} onValueChange={setProjectId}>
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

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="hours">Allocated Hours (Weekly)</Label>
          <Input
            id="hours"
            type="number"
            min={1}
            step={1}
            value={hoursPerWeek}
            onChange={(e) => setHoursPerWeek(e.target.value)}
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
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="start_date">Start</Label>
          <Input id="start_date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="end_date">End</Label>
          <Input id="end_date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={!projectId || mutation.isPending}>
          {mutation.isPending ? "Assigning..." : role === "qa_lead" ? "Assign Resource" : "Propose Assignment"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Delete the old edit dialog**

```bash
rm src/components/allocations/allocation-edit-dialog.tsx
```

- [ ] **Step 3: Write `src/components/allocations/rebaseline-dialog.tsx`**

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
import { proposeAllocationChange, updateAllocation } from "@/features/allocation-action";
import type { Allocation } from "@/lib/allocation";
import type { Priority } from "@/lib/project";
import type { ProfileRole } from "@/lib/profile";

type RebaselineDialogProps = {
  allocation: Allocation;
  role: ProfileRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RebaselineDialog({ allocation, role, open, onOpenChange }: RebaselineDialogProps) {
  const [startDate, setStartDate] = useState(allocation.start_date);
  const [endDate, setEndDate] = useState(allocation.end_date ?? "");
  const [hoursPerWeek, setHoursPerWeek] = useState(String(allocation.hours_per_week));
  const [priority, setPriority] = useState<Priority>(allocation.priority);
  const queryClient = useQueryClient();

  const isLead = role === "qa_lead";

  const mutation = useMutation({
    mutationFn: () =>
      isLead
        ? updateAllocation(allocation.id, {
            user_id: allocation.user_id,
            project_id: allocation.project_id,
            role_on_project: allocation.role_on_project,
            hours_per_week: Number(hoursPerWeek),
            start_date: startDate,
            end_date: endDate || undefined,
            priority,
          })
        : proposeAllocationChange(allocation.id, {
            hours_per_week: Number(hoursPerWeek),
            start_date: startDate,
            end_date: endDate || undefined,
            priority,
          }),
    onSuccess: () => {
      toast.success(isLead ? "Assignment updated" : "Change proposed — pending QA Lead approval");
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", allocation.user_id] });
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rebaseline assignment</DialogTitle>
          {!isLead && (
            <DialogDescription>Changes here need QA Lead approval before they take effect.</DialogDescription>
          )}
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="rebaseline_hours">Allocated Hours (Weekly)</Label>
            <Input
              id="rebaseline_hours"
              type="number"
              min={1}
              step={1}
              value={hoursPerWeek}
              onChange={(e) => setHoursPerWeek(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rebaseline_start">Start</Label>
              <Input id="rebaseline_start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rebaseline_end">End</Label>
              <Input id="rebaseline_end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rebaseline_priority">Priority</Label>
            <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
              <SelectTrigger id="rebaseline_priority" className="w-full">
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
              {mutation.isPending ? "Saving..." : isLead ? "Save" : "Propose change"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: `src/components/allocations/allocation-form.tsx` is clean; a new error appears in `src/components/allocations/assignments-table.tsx` (still imports the now-deleted `AllocationEditDialog`) — expected, resolved in Task 13.

- [ ] **Step 5: Commit**

```bash
git add src/components/allocations/allocation-form.tsx src/components/allocations/rebaseline-dialog.tsx
git rm src/components/allocations/allocation-edit-dialog.tsx
git commit -m "feat: add priority to allocation form; replace edit dialog with role-aware Rebaseline"
```

---

### Task 12: Allocation Tool UI — bulk "Add Project" dialog

**Files:**
- Create: `src/components/ui/checkbox.tsx` (via shadcn CLI)
- Create: `src/components/allocations/bulk-assign-dialog.tsx`

**Interfaces:**
- Consumes: `createBulkAllocations` (Task 9), `getAssignableProfiles` (v1 `@/features/profile-action`), `getProjects` (v1 `@/features/project-action`), `weeksBetween` (Task 3).
- Produces: `BulkAssignDialog` from `@/components/allocations/bulk-assign-dialog`, consumed by Task 13's page content.

- [ ] **Step 1: Add the shadcn Checkbox component**

Run: `npx shadcn@latest add checkbox --yes`
Expected: creates `src/components/ui/checkbox.tsx`.

- [ ] **Step 2: Write `src/components/allocations/bulk-assign-dialog.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
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
import { createBulkAllocations } from "@/features/allocation-action";
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

  const previewHoursPerWeek = useMemo(() => {
    if (!selectedProject || !selectedProject.end_date || selectedUserIds.length === 0) return null;
    const weeks = weeksBetween(selectedProject.start_date, selectedProject.end_date);
    return selectedProject.total_working_hours / selectedUserIds.length / weeks;
  }, [selectedProject, selectedUserIds.length]);

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
      queryClient.invalidateQueries({ queryKey: ["allocations"] });
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
            Total working hours are split evenly across the QA members you select.
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

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors in this task's files (`assignments-table.tsx`'s deleted-import error from Task 11 is still outstanding — resolved next task).

Run: `npx eslint src/components/ui/checkbox.tsx src/components/allocations/bulk-assign-dialog.tsx`
Expected: zero errors/warnings.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/checkbox.tsx src/components/allocations/bulk-assign-dialog.tsx package.json package-lock.json
git commit -m "feat: add bulk even-split assignment dialog"
```

---

### Task 13: Allocation Tool UI — wire up AssignmentsTable and the page

**Files:**
- Modify: `src/components/allocations/assignments-table.tsx`
- Modify: `src/components/allocations/allocations-page-content.tsx`

**Interfaces:**
- Consumes: `RebaselineDialog` (Task 11), `BulkAssignDialog` (Task 12), `hasPendingChange` (Task 2).
- Produces: the fully-updated `/allocations` route. No exports consumed by other tasks (leaf feature).

- [ ] **Step 1: Replace `src/components/allocations/assignments-table.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RebaselineDialog } from "@/components/allocations/rebaseline-dialog";
import {
  deleteAllocation,
  getAllocationsForUser,
  withdrawAllocationProposal,
} from "@/features/allocation-action";
import { hasPendingChange, type Allocation } from "@/lib/allocation";
import { formatDate } from "@/lib/format";
import type { Priority, Project } from "@/lib/project";
import type { ProfileRole } from "@/lib/profile";

const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

type AssignmentsTableProps = {
  userId: string;
  userName: string;
  projects: Project[];
  role: ProfileRole;
  currentProfileId: string;
};

export function AssignmentsTable({ userId, userName, projects, role, currentProfileId }: AssignmentsTableProps) {
  const [rebaseliningAllocation, setRebaseliningAllocation] = useState<Allocation | null>(null);
  const queryClient = useQueryClient();
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

  const { data, isLoading } = useQuery({
    queryKey: ["allocations", "user", userId],
    queryFn: () => getAllocationsForUser(userId),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAllocation,
    onSuccess: () => {
      toast.success("Assignment removed");
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", userId] });
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const withdrawMutation = useMutation({
    mutationFn: withdrawAllocationProposal,
    onSuccess: () => {
      toast.success("Proposal withdrawn");
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", userId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = data ?? [];
  const totalAllocated = rows
    .filter((a) => a.approval_status === "approved")
    .reduce((sum, a) => sum + a.hours_per_week, 0);

  const canRebaseline = role === "qa_lead" || role === "project_manager";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Current Assignments: {userName}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Project Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Hours/Wk</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Timeline</TableHead>
              <TableHead className="pr-6 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No assignments yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((allocation) => (
                <TableRow key={allocation.id}>
                  <TableCell className="pl-6 text-sm font-medium">
                    {projectNameById.get(allocation.project_id) ?? "—"}
                    {allocation.approval_status === "pending" && (
                      <Badge variant="outline" className="ml-2 border-amber-200 bg-amber-50 text-amber-700">
                        Pending
                      </Badge>
                    )}
                    {allocation.approval_status === "rejected" && (
                      <Badge variant="outline" className="ml-2 border-rose-200 bg-rose-50 text-rose-700">
                        Rejected
                      </Badge>
                    )}
                    {allocation.approval_status === "approved" && hasPendingChange(allocation) && (
                      <Badge variant="outline" className="ml-2 border-blue-200 bg-blue-50 text-blue-700">
                        Pending Change
                      </Badge>
                    )}
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
                  <TableCell className="pr-6 text-right">
                    <div className="flex justify-end gap-1">
                      {canRebaseline && allocation.approval_status === "approved" && !hasPendingChange(allocation) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => setRebaseliningAllocation(allocation)}
                          aria-label="Rebaseline assignment"
                        >
                          <GitBranch className="size-4" />
                        </Button>
                      )}
                      {role === "qa_lead" && allocation.approval_status === "approved" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(allocation.id)}
                          aria-label="Delete assignment"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                      {role === "project_manager" &&
                        allocation.approval_status === "pending" &&
                        allocation.proposed_by === currentProfileId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={withdrawMutation.isPending}
                            onClick={() => withdrawMutation.mutate(allocation.id)}
                          >
                            <Undo2 className="size-4" />
                            Withdraw
                          </Button>
                        )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="pl-6">Total Allocated</TableCell>
                <TableCell className="text-right tabular-nums">{Math.round(totalAllocated * 10) / 10} hrs</TableCell>
                <TableCell colSpan={3} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </CardContent>

      {rebaseliningAllocation && (
        <RebaselineDialog
          key={rebaseliningAllocation.id}
          allocation={rebaseliningAllocation}
          role={role}
          open
          onOpenChange={(o) => {
            if (!o) setRebaseliningAllocation(null);
          }}
        />
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Add the "Add Project" bulk-assign entry point to `src/components/allocations/allocations-page-content.tsx`**

Full replacement:

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
import { getWeeklyDashboard } from "@/features/dashboard-action";
import { getProjects } from "@/features/project-action";
import { isoWeekRange } from "@/lib/load";
import type { ProfileRole } from "@/lib/profile";

function mondayOf(date: Date): string {
  return isoWeekRange(date).start;
}

export function AllocationsPageContent({ role, currentProfileId }: { role: ProfileRole; currentProfileId: string }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);

  const canWrite = role === "qa_lead" || role === "project_manager";

  const { data: dashboard, isLoading: loadLoading } = useQuery({
    queryKey: ["weekly-dashboard", weekStart],
    queryFn: () => getWeeklyDashboard(weekStart),
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

  const selected = resources.find((r) => r.profile.id === selectedUserId) ?? null;

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

      <div className="flex items-center gap-2">
        <label htmlFor="week-start" className="text-sm text-muted-foreground">
          Planning week of
        </label>
        <Input
          id="week-start"
          type="date"
          value={weekStart}
          onChange={(e) => setWeekStart(mondayOf(new Date(`${e.target.value}T00:00:00Z`)))}
          className="w-40"
        />
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
            <div className="space-y-2">
              {loadLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : filteredResources.length === 0 ? (
                <p className="text-sm text-muted-foreground">No resources found.</p>
              ) : (
                filteredResources.map((r) => (
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
                        {r.allocatedHours}/{r.profile.capacity_hours} hrs
                      </span>
                    </div>
                    <LoadBar percent={r.loadPercent} className="mt-2" />
                  </button>
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
                {selected.profile.name} — {selected.allocatedHours}/{selected.profile.capacity_hours} hrs this week.
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

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: zero errors project-wide (this resolves the last outstanding errors from Task 2 onward).

Run: `npx eslint src/components/allocations`
Expected: zero errors/warnings.

- [ ] **Step 4: Manual smoke check**

`npm run dev`. As QA Lead: on Allocation Tool, select a QA, use the single-QA form to assign them to a project with a Priority set — confirm the assignments table shows the Priority column and a working "Rebaseline" (branch icon) action that saves immediately. Click "Add Project", pick a project with `total_working_hours` and both dates set, select 2 QA members, confirm the preview shows the expected hrs/week (`total_working_hours / 2 / weeks`), submit, and confirm both QAs now have the assignment with that computed hours/week. As Project Manager: rebaseline an existing approved assignment — confirm it shows a "Pending Change" badge and the row's Rebaseline button disappears until that change is resolved. As QA Lead, go to a QA with more concurrent approved projects than `Settings -> Max Parallel Projects` allows, and confirm assigning them to one more is rejected with the expected error message (temporarily lower the setting to 1 to trigger this easily, then restore it to 3 afterward).

- [ ] **Step 5: Commit**

```bash
git add src/components/allocations/assignments-table.tsx src/components/allocations/allocations-page-content.tsx
git commit -m "feat: wire up rebaseline, pending-change badges, and bulk assign on Allocation Tool"
```

---

### Task 14: Approvals UI — Pending Allocation Changes section

**Files:**
- Modify: `src/components/approvals/approvals-page-content.tsx`

**Interfaces:**
- Consumes: `getPendingAllocationChanges`, `approveAllocationChange`, `rejectAllocationChange` (Task 10), `Allocation` (Task 2, carries live + `proposed_*` fields).
- Produces: nothing consumed elsewhere (leaf feature).

- [ ] **Step 1: Replace `src/components/approvals/approvals-page-content.tsx`**

Full replacement — same file as v1 with a third card ("Pending Allocation Changes") added after "Future Assignment Proposals", plus the new imports/query/mutations it needs:

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["approvals"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["allocations"] });
  }

  const approveProjectMutation = useMutation({
    mutationFn: approveProjectProposal,
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
              <div key={proposal.id} className="rounded-md border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{proposal.name}</span>
                      <Badge variant="secondary">{proposal.product}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(proposal.start_date)} – {proposal.end_date ? formatDate(proposal.end_date) : "Ongoing"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={rejectProjectMutation.isPending}
                      onClick={() => rejectProjectMutation.mutate(proposal.id)}
                    >
                      <X className="size-4" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={approveProjectMutation.isPending}
                      onClick={() => approveProjectMutation.mutate(proposal.id)}
                    >
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

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: zero errors.

Run: `npx eslint src/components/approvals`
Expected: zero errors/warnings.

- [ ] **Step 3: Manual smoke check**

As Project Manager, rebaseline an approved allocation (Task 13's Rebaseline action) with different hours/week and dates. Log in as QA Lead, open Approvals, confirm the "Pending Allocation Changes" card shows the Current vs. Proposed rows with the right project name. Click Approve — confirm the allocation's live values update to match what was proposed and the card empties. Repeat and click Reject instead — confirm the live values stay untouched and the "Pending Change" badge disappears from the Allocation Tool.

- [ ] **Step 4: Commit**

```bash
git add src/components/approvals/approvals-page-content.tsx
git commit -m "feat: add pending allocation changes review to Approvals page"
```

---

### Task 15: Dashboard — utilization bars

**Files:**
- Modify: `src/components/dashboard/dashboard-page-content.tsx`

**Interfaces:**
- Consumes: `getWeeklyDashboard` (unchanged v1 signature, returns `WeeklyDashboard` with `totalCapacity`/`totalAllocated`/`resourceLoad: { profile, allocatedHours, loadPercent }[]`), `LoadBar` (unchanged v1 component, `{ percent, className }`).
- Produces: nothing consumed elsewhere (leaf feature).

- [ ] **Step 1: Replace `src/components/dashboard/dashboard-page-content.tsx`**

Same file as v1 with two changes: the "Total Allocated" card gains a `LoadBar` showing `totalAllocated / totalCapacity`, and a new fourth stat card, "Avg Available Capacity", is added showing the average of `100 − loadPercent` across `resourceLoad`. The stat grid becomes 4 columns on large screens to fit it.

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadBar } from "@/components/ui/load-bar";
import { getMonthlyDashboard, getWeeklyDashboard } from "@/features/dashboard-action";
import { isoWeekRange } from "@/lib/load";
import type { Product } from "@/lib/project";

function mondayOf(date: Date): string {
  return isoWeekRange(date).start;
}

const PRODUCT_LABEL: Record<Product, string> = {
  qris_h2h: "QRIS H2H",
  qris_bo: "QRIS BO",
  qrcb: "QRCB",
  pi: "PI",
  jv: "JV",
  ccw: "CCW",
};

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

  const monthValue = `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;

  const resourceLoad = weekly?.resourceLoad ?? [];
  const allocatedPercent =
    weekly && weekly.totalCapacity > 0 ? (weekly.totalAllocated / weekly.totalCapacity) * 100 : 0;
  const avgAvailablePercent =
    resourceLoad.length > 0
      ? resourceLoad.reduce((sum, r) => sum + (100 - r.loadPercent), 0) / resourceLoad.length
      : 0;

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
                      {project.name} <span className="text-muted-foreground">({PRODUCT_LABEL[project.product]})</span>
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
Expected: zero errors project-wide — this is the last file the v2 plan touches, so this should be a completely clean run.

Run: `npx eslint src/components/dashboard`
Expected: zero errors/warnings.

- [ ] **Step 3: Manual smoke check**

Open `/dashboard`. Confirm the "Total Allocated" card now shows a `LoadBar` under the hours figure (green/amber/red matching the existing load-status thresholds), and a fourth "Avg Available Capacity" card appears showing a sensible percentage (100% when nobody is allocated, dropping as allocations increase). Change the week picker to a week with no allocations at all and confirm it shows 100% without dividing by zero or crashing (covers `totalCapacity === 0` and empty `resourceLoad` edge cases if there are zero active QA members, and the "everyone at 0%" case if there are active members but no allocations that week).

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/dashboard-page-content.tsx
git commit -m "feat: add utilization bars to Resource Dashboard"
```

---

### Task 16: End-to-end manual verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Apply the migration**

Open the Supabase Dashboard SQL editor for this project and run `supabase/migrations/0002_qa_resource_manager_v2.sql` (Task 1) in full. Confirm it completes with no errors and `select * from app_settings;` returns exactly one row with `max_parallel_projects = 3`.

- [ ] **Step 2: Full type-check and lint pass**

Run: `npx tsc --noEmit`
Expected: zero errors.

Run: `npx eslint .`
Expected: zero errors/warnings (excluding the `globalIgnores` paths already configured).

Run: `npm run build`
Expected: production build succeeds.

- [ ] **Step 3: Settings and max-parallel-projects (spec §1, §4)**

`npm run dev`. Log in as QA Lead. Open `/settings`, confirm it shows "Max Parallel Projects" defaulting to 3, change it to 1, save, reload the page and confirm it persisted. Log in as QA Member or Project Manager and confirm `/settings` is not in the sidebar and navigating to it directly redirects away (same guard pattern as `/approvals`).

With the limit still at 1: on Project Portfolio, create two approved projects with overlapping date ranges. On Allocation Tool, assign a QA to the first — succeeds. Try assigning the same QA to the second with an overlapping range — confirm it's rejected with an error naming the limit. Change the limit back to 3 on `/settings`, retry the same assignment — confirm it now succeeds.

- [ ] **Step 4: Work item types and mandatory fields (spec §2, §6)**

On Project Portfolio, open "New Item" as QA Lead. Confirm the Item Type selector offers Project / Support Testing / Problem Incident / Service Request. Try submitting with Total Working Hours, Priority, or End Date empty — confirm each is rejected client-side with a validation message. Create one item of each of the four types with valid data; confirm the table shows a Type badge and Priority badge per row, plus a Total Hrs column, for all four.

- [ ] **Step 5: Allocation priority and the three assignment flows (spec §3, §5)**

Single-QA form: assign a QA to a project with a Priority, confirm it saves and displays. Bulk "Add Project": pick a project with `total_working_hours = 80` and a 2-week date range (so `weeksBetween = 2`), select 2 QAs, confirm the preview shows `80 / 2 / 2 = 20` hrs/week each, submit, confirm both allocations were created at 20 hrs/week. Rebaseline as QA Lead: change hours/dates/priority on an approved allocation, confirm it applies immediately with no approval step. Rebaseline as Project Manager: same action, confirm it instead shows a "Pending Change" badge and does not change the live values until a QA Lead approves it on `/approvals` (Task 14's section) — verify both Approve and Reject outcomes as in Task 14 Step 3.

- [ ] **Step 6: Password reset (spec §7)**

As QA Lead, on Team Management, use "Reset Password" on an active user. Confirm a dialog shows a new temporary password once. Log out, log in as that user with the temporary password, confirm it works. Confirm QA Member and Project Manager roles don't see the "Reset Password" action.

- [ ] **Step 7: Dashboard utilization bars (spec §8)**

Already covered in Task 15 Step 3 — re-confirm on the current live data after all the above changes: "Total Allocated" card's `LoadBar` and the "Avg Available Capacity" card both reflect the current week's real allocations.

- [ ] **Step 8: Auto-complete cascade (spec §9 — the "release working hour" requirement)**

Set up a project with three allocations: (a) one QA already started (`start_date` in the past, no `end_date`), (b) one QA not yet started (`start_date` in the future), (c) one *pending* allocation proposal (create it as a Project Manager, don't approve it) on the same project. Also stage a rebaseline change (`proposed_*` fields set) on allocation (a) via a PM rebaseline request, left unresolved.

As QA Lead or Project Manager, edit that project and set Status to "Completed" (100%). Confirm, after the update:
- Allocation (a): `end_date` is now today, `start_date`/`hours_per_week` unchanged, `proposed_*` fields cleared (the rebaseline request is gone from Approvals).
- Allocation (b): the row no longer exists (deleted).
- Allocation (c): its `approval_status` is now `rejected` and it no longer appears in the "Future Assignment Proposals" list on Approvals.
- The QA from (a) shows reduced hours on the Resource Dashboard's "Resource Load" section for the current week (their hours from this project no longer count going forward, though the just-completed week itself — where `end_date = today` still falls inside the range — still counts through today).
- Setting a *different* project's status to any value other than "Completed" leaves all of its allocations completely untouched.

- [ ] **Step 9: Regression pass on v1 flows**

Confirm nothing in v1 broke: User CRUD (create/edit/deactivate a profile), Project CRUD approval workflow for a plain "project"-type item (PM proposes, QA Lead approves/rejects), Workload Distribution Report's monthly per-member/per-project tables still populate correctly.

- [ ] **Step 10: Fix any issues found**

If any step above fails, fix the underlying code (not the test), re-run `npx tsc --noEmit` and `npx eslint .`, and re-verify the specific failing step before moving on. Do not commit broken intermediate states — squash the fix into a new commit describing what was wrong, e.g. `fix: correct auto-complete cascade for pending rebaseline changes`.

---

## Self-Review

**Spec coverage** — every section of `docs/superpowers/specs/2026-08-10-qa-resource-manager-v2-design.md` maps to a task:
- §1 Global settings → Task 1 (migration), Task 4 (`SettingsInput` schema), Task 5 (feature + UI)
- §2 Work items → Task 1 (migration), Task 2 (`ItemType`/`Priority` types), Task 4 (`ProjectInput`), Task 8 (Portfolio UI)
- §3 Allocation priority + staging → Task 1 (migration), Task 2 (`Allocation` fields + `hasPendingChange`), Task 4 (`AllocationChangeInput`), Task 9 (`proposeAllocationChange`), Task 10 (`approveAllocationChange`/`rejectAllocationChange`), Task 11 (`RebaselineDialog`)
- §4 Max-parallel-projects → Task 3 (`overlappingProjectCount`), Task 9 (`assertWithinParallelLimit`, called from `createAllocation`/`updateAllocation`/`createBulkAllocations`), Task 10 (called from `approveAllocation`/`approveProjectProposal`/`approveAllocationChange`)
- §5 Three assignment flows → Task 9 (`createBulkAllocations`), Task 11 (single-QA form + rebaseline), Task 12 (bulk dialog), Task 13 (wiring)
- §6 Portfolio UI → Task 8
- §7 Password reset → Task 6
- §8 Dashboard utilization → Task 15
- §9 Auto-complete cascade → Task 7 (`releaseAllocationsForCompletedProject`, called from `updateProject`)
- Out of scope items (per-QA custom limits, audit trail, notifications, editable enum lists) are correctly not implemented anywhere above.

**Placeholder scan** — no "TBD"/"TODO"/"similar to Task N" patterns anywhere in Tasks 1–16; every code block is a full, runnable replacement or addition; every step names its exact verification command and expected result.

**Type consistency** — checked across tasks: `Allocation` (Task 2) fields match every consumer (Tasks 9, 10, 11, 13, 14); `Priority`/`ItemType` (Task 2, from `@/lib/project`) imported consistently everywhere they're used, never redefined; `AppSettings` (Task 2) matches `getSettings`/`updateSettings` (Task 5) and `assertWithinParallelLimit` (Task 9); `weeksBetween`/`rangesOverlap`/`overlappingProjectCount`/`DatedRange`/`AllocationForOverlapCalc` (Task 3) signatures match their call sites in Tasks 9, 10, 12; `RebaselineDialog` props (`allocation`, `role`, `open`, `onOpenChange`, defined Task 11) match its usage in Task 13; `BulkAssignDialog` props (`role`, `open`, `onOpenChange`, defined Task 12) match Task 13; `hasPendingChange(allocation): boolean` (Task 2) used consistently in Tasks 13 and 14's badge/gating logic; `getWeeklyDashboard`/`LoadBar` (unchanged v1 signatures, verified against current source) match their v2 call sites in Tasks 13 and 15.
