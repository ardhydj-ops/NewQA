# Testing Document Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `head_of_qa` role (full QA-Lead parity plus testing-document approval authority), a submit → approve/reject workflow for finished projects gated on 100% progress, a shared history page, and toggleable email notifications.

**Architecture:** One new DB table (`testing_document_submissions`, insert-only history) plus one new `app_settings` column. A single shared `QA_LEAD_ROLES` constant threads through every existing QA-Lead-only check so `head_of_qa` inherits full parity mechanically. A thin Resend wrapper (`src/lib/email.ts`) is called from the new submission actions, gated by the existing Settings page's toggle pattern.

**Tech Stack:** Next.js App Router, Supabase (Postgres + Auth), TanStack Query 5, Zod 4, shadcn/ui, sonner, Resend (new). No test runner in this repo — verification is `tsc --noEmit` + `eslint` per task, `npm run build` at the end, plus a manual/browser check (this app's established practice).

## Global Constraints

- `head_of_qa` has every capability `qa_lead` has, app-wide, via one shared `QA_LEAD_ROLES: ProfileRole[] = ["qa_lead", "head_of_qa"]` constant in `src/lib/profile.ts` — never duplicate the role list inline.
- Two deliberate exceptions to that parity: only `qa_lead` (not `head_of_qa`) can call `submitTestingDocument`; only `head_of_qa` (not `qa_lead`) can call `approveTestingSubmission`/`rejectTestingSubmission`.
- Submitting requires `project.approval_status === "approved"` AND `project.progress_percent === 100`, and no existing `pending` submission on that project.
- Rejecting requires a non-empty comment (`RejectSubmissionInput`).
- No file/document upload — review happens via the project's existing `jira_link`/`jiva_link`.
- Email sends are best-effort: a failure is logged (`console.error`) and never thrown — it must never break the underlying submit/approve/reject action. Every send site checks `app_settings.email_notifications_enabled` first and skips entirely when off.
- This repo has no linked Supabase CLI project and no direct Postgres connection string — migrations in `supabase/migrations/` are applied by hand via the Supabase Studio SQL editor. Flag this at the end of Task 1; don't attempt to apply it yourself.
- This repo has no Resend account configured yet — flag `RESEND_API_KEY`/`RESEND_FROM_EMAIL` as needed at the end of Task 4; `sendEmail` degrades gracefully (logs, doesn't throw) when they're unset, so every other task's code still compiles and runs without them.

---

### Task 1: Data model — migration, types, role enum

**Files:**
- Create: `supabase/migrations/0007_head_of_qa_and_testing_approvals.sql`
- Create: `src/lib/testing-approval.ts`
- Modify: `src/lib/profile.ts`
- Modify: `src/lib/settings.ts`
- Modify: `src/features/profile-schema.ts`
- Modify: `src/components/team/team-form-dialog.tsx`
- Modify: `.env.example`

**Interfaces:**
- Produces: `ProfileRole` gains `"head_of_qa"`; new export `QA_LEAD_ROLES: ProfileRole[]` from `@/lib/profile` — every later task imports this. `AppSettings.email_notifications_enabled: boolean`. New types `SubmissionStatus` and `TestingDocumentSubmission` from `@/lib/testing-approval` — Task 5's actions and Task 6's UI both import these.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0007_head_of_qa_and_testing_approvals.sql
-- Head of QA role + testing document approval workflow.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('qa_lead','qa_member','project_manager','head_of_qa'));

create table public.testing_document_submissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_by uuid not null references public.profiles(id),
  submitted_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  rejection_comment text,
  created_at timestamptz not null default now()
);

create index testing_document_submissions_project_id_idx
  on public.testing_document_submissions (project_id);

alter table public.testing_document_submissions enable row level security;
create policy "Authenticated read" on public.testing_document_submissions
  for select using (auth.role() = 'authenticated');

alter table public.app_settings
  add column if not exists email_notifications_enabled boolean not null default false;
```

- [ ] **Step 2: Add `head_of_qa` and `QA_LEAD_ROLES` to `src/lib/profile.ts`**

```ts
export type ProfileRole = "qa_lead" | "qa_member" | "project_manager" | "head_of_qa";

export const QA_LEAD_ROLES: ProfileRole[] = ["qa_lead", "head_of_qa"];

export type Profile = {
  id: string;
  name: string;
  email: string;
  role: ProfileRole;
  qa_group_id: string | null;
  capacity_days: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 3: Add `email_notifications_enabled` to `src/lib/settings.ts`**

```ts
export type AppSettings = {
  max_parallel_projects: number;
  email_notifications_enabled: boolean;
};
```

- [ ] **Step 4: Create `src/lib/testing-approval.ts`**

```ts
export type SubmissionStatus = "pending" | "approved" | "rejected";

export type TestingDocumentSubmission = {
  id: string;
  project_id: string;
  status: SubmissionStatus;
  submitted_by: string;
  submitted_at: string;
  decided_by: string | null;
  decided_at: string | null;
  rejection_comment: string | null;
  created_at: string;
};
```

- [ ] **Step 5: Add `head_of_qa` to the role enum in `src/features/profile-schema.ts`**

Change line 6 from:

```ts
  role: z.enum(["qa_lead", "qa_member", "project_manager"]),
```

to:

```ts
  role: z.enum(["qa_lead", "qa_member", "project_manager", "head_of_qa"]),
```

- [ ] **Step 6: Add "Head of QA" to the role dropdown in `team-form-dialog.tsx`**

In the `<SelectContent>` block under the `role` `<Select>` (around line 171-175), change:

```tsx
                <SelectContent>
                  <SelectItem value="qa_lead">QA Lead</SelectItem>
                  <SelectItem value="qa_member">QA Member</SelectItem>
                  <SelectItem value="project_manager">Project Manager</SelectItem>
                </SelectContent>
```

to:

```tsx
                <SelectContent>
                  <SelectItem value="qa_lead">QA Lead</SelectItem>
                  <SelectItem value="head_of_qa">Head of QA</SelectItem>
                  <SelectItem value="qa_member">QA Member</SelectItem>
                  <SelectItem value="project_manager">Project Manager</SelectItem>
                </SelectContent>
```

- [ ] **Step 7: Document the new env vars in `.env.example`**

Append:

```
# Resend API key — for testing-document-approval email notifications.
# Create an account at https://resend.com, verify a sending domain, and
# generate an API key. Notifications silently no-op (logged, not thrown)
# if this or RESEND_FROM_EMAIL is unset.
RESEND_API_KEY=re_...your-api-key...

# The "from" address used for outgoing notification emails — must be on a
# domain verified in your Resend account.
RESEND_FROM_EMAIL=QA Resource Manager <notifications@yourdomain.com>
```

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/profile.ts src/lib/settings.ts src/lib/testing-approval.ts src/features/profile-schema.ts src/components/team/team-form-dialog.tsx`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/0007_head_of_qa_and_testing_approvals.sql src/lib/profile.ts src/lib/settings.ts src/lib/testing-approval.ts src/features/profile-schema.ts src/components/team/team-form-dialog.tsx .env.example
git commit -m "feat: add head_of_qa role and testing_document_submissions table"
```

- [ ] **Step 10: Flag the migration for manual application**

Tell your human partner: "Migration `0007_head_of_qa_and_testing_approvals.sql` is written but not yet applied — please run it against the Supabase project's SQL editor before Task 7's live verification." Continue to Task 2 regardless — every remaining task compiles and lints against the type layer, not the live database.

---

### Task 2: Server-side role-check expansion

**Files:**
- Modify: `src/features/allocation-action.ts`
- Modify: `src/features/approval-action.ts`
- Modify: `src/features/product-action.ts`
- Modify: `src/features/profile-action.ts`
- Modify: `src/features/project-action.ts`
- Modify: `src/features/settings-action.ts`
- Modify: `src/features/qa-group-action.ts`

**Interfaces:**
- Consumes: `QA_LEAD_ROLES` from `@/lib/profile` (Task 1).

This task is one mechanical transformation applied to 7 files: add `import { QA_LEAD_ROLES } from "@/lib/profile";` near the top of each file (alongside its existing imports), then replace every `requireRole(["qa_lead"])` with `requireRole(QA_LEAD_ROLES)`. `allocation-action.ts` additionally has two `profile.role === "qa_lead"` boolean checks (not `requireRole` calls) that become `QA_LEAD_ROLES.includes(profile.role)`.

- [ ] **Step 1: `src/features/allocation-action.ts`**

Add the import (after the existing `import type { Priority } from "@/lib/project";` line):

```ts
import { QA_LEAD_ROLES } from "@/lib/profile";
```

Replace `requireRole(["qa_lead"])` with `requireRole(QA_LEAD_ROLES)` at both call sites: line 239 (`updateAllocation`) and line 275 (`deleteAllocation`).

Replace `const isLead = profile.role === "qa_lead";` with `const isLead = QA_LEAD_ROLES.includes(profile.role);` at both occurrences: line 222 (`createAllocation`) and line 398 (`createBulkAllocations`).

- [ ] **Step 2: `src/features/approval-action.ts`**

Add the import (after `import { requireRole } from "@/lib/auth";`):

```ts
import { QA_LEAD_ROLES } from "@/lib/profile";
```

Replace `requireRole(["qa_lead"])` with `requireRole(QA_LEAD_ROLES)` at all 12 call sites: lines 13, 32, 46, 59, 96, 116, 142, 151, 194, 214, 227, 261 (`getPendingProjectProposals`, `getPendingAllocationProposals`, `getPendingAllocationChanges`, `approveProjectProposal`, `rejectProjectProposal`, `approveAllocation`, `rejectAllocation`, `approveAllocationChange`, `rejectAllocationChange`, `getPendingProjectChanges`, `approveProjectChange`, `rejectProjectChange`).

- [ ] **Step 3: `src/features/product-action.ts`**

Add the import (after `import { requireRole } from "@/lib/auth";`):

```ts
import { QA_LEAD_ROLES } from "@/lib/profile";
```

Replace `requireRole(["qa_lead"])` with `requireRole(QA_LEAD_ROLES)` at all 3 call sites: lines 22, 36, 50 (`createProduct`, `updateProduct`, `deleteProduct`).

- [ ] **Step 4: `src/features/profile-action.ts`**

Add the import (after `import { requireRole } from "@/lib/auth";`):

```ts
import { QA_LEAD_ROLES } from "@/lib/profile";
```

Replace `requireRole(["qa_lead"])` with `requireRole(QA_LEAD_ROLES)` at all 4 call sites: lines 40, 81, 104, 113 (`createProfile`, `updateProfile`, `setProfileActive`, `resetPassword`).

- [ ] **Step 5: `src/features/project-action.ts`**

Add the import (after `import { requireRole } from "@/lib/auth";`):

```ts
import { QA_LEAD_ROLES } from "@/lib/profile";
```

Replace `requireRole(["qa_lead"])` with `requireRole(QA_LEAD_ROLES)` at all 3 call sites: lines 42, 122, 159 (`createProject`, `updateProject`, `deleteProject`).

- [ ] **Step 6: `src/features/settings-action.ts`**

Add the import (after `import { requireRole } from "@/lib/auth";`):

```ts
import { QA_LEAD_ROLES } from "@/lib/profile";
```

Replace `requireRole(["qa_lead"])` with `requireRole(QA_LEAD_ROLES)` at the 1 call site: line 21 (`updateSettings`).

- [ ] **Step 7: `src/features/qa-group-action.ts`**

Add the import (after `import { requireRole } from "@/lib/auth";`):

```ts
import { QA_LEAD_ROLES } from "@/lib/profile";
```

Replace `requireRole(["qa_lead"])` with `requireRole(QA_LEAD_ROLES)` at all 3 call sites: lines 22, 36, 50 (`createQaGroup`, `updateQaGroup`, `deleteQaGroup`).

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/features/allocation-action.ts src/features/approval-action.ts src/features/product-action.ts src/features/profile-action.ts src/features/project-action.ts src/features/settings-action.ts src/features/qa-group-action.ts`
Expected: no errors.

Run this to confirm no `requireRole(["qa_lead"])` call sites remain anywhere:

```bash
grep -rn 'requireRole(\["qa_lead"\])' src/
```

Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add src/features/allocation-action.ts src/features/approval-action.ts src/features/product-action.ts src/features/profile-action.ts src/features/project-action.ts src/features/settings-action.ts src/features/qa-group-action.ts
git commit -m "feat: give head_of_qa full server-side parity with qa_lead"
```

---

### Task 3: Client-side role-check expansion

**Files:**
- Modify: `src/components/projects/project-table.tsx`
- Modify: `src/components/projects/projects-page-content.tsx`
- Modify: `src/components/allocations/allocations-page-content.tsx`
- Modify: `src/components/allocations/rebaseline-dialog.tsx`
- Modify: `src/components/allocations/assignments-table.tsx`
- Modify: `src/components/allocations/bulk-assign-dialog.tsx`
- Modify: `src/components/allocations/allocation-form.tsx`
- Modify: `src/components/team/team-page-content.tsx`
- Modify: `src/app/(app)/approvals/page.tsx`
- Modify: `src/app/(app)/settings/page.tsx`
- Modify: `src/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: `QA_LEAD_ROLES` from `@/lib/profile` (Task 1).

Same mechanical pattern as Task 2, applied to every UI-side `role === "qa_lead"` check and the two route guards. Each file gets one added import line: `import { QA_LEAD_ROLES } from "@/lib/profile";`.

- [ ] **Step 1: `src/components/projects/project-table.tsx`**

Add the import (alongside the existing `import type { ItemType, Priority, Project, ProjectStatus } from "@/lib/project";` / `import type { ProfileRole } from "@/lib/profile";` lines):

```ts
import { QA_LEAD_ROLES } from "@/lib/profile";
```

Change line 157 from:

```ts
  const canEdit = role === "qa_lead";
```

to:

```ts
  const canEdit = QA_LEAD_ROLES.includes(role);
```

- [ ] **Step 2: `src/components/projects/projects-page-content.tsx`**

Add the import (alongside `import type { ItemType, Priority, ProjectStatus } from "@/lib/project";`):

```ts
import { QA_LEAD_ROLES } from "@/lib/profile";
```

Change line 145 from:

```tsx
        {role === "qa_lead" && (
```

to:

```tsx
        {QA_LEAD_ROLES.includes(role) && (
```

Change line 295 from:

```tsx
      {role === "qa_lead" && <ProjectFormDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />}
```

to:

```tsx
      {QA_LEAD_ROLES.includes(role) && <ProjectFormDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />}
```

- [ ] **Step 3: `src/components/allocations/allocations-page-content.tsx`**

Add the import (alongside `import type { ProfileRole } from "@/lib/profile";`):

```ts
import { QA_LEAD_ROLES } from "@/lib/profile";
```

Change line 35 from:

```ts
  const canWrite = role === "qa_lead" || role === "project_manager";
```

to:

```ts
  const canWrite = QA_LEAD_ROLES.includes(role) || role === "project_manager";
```

- [ ] **Step 4: `src/components/allocations/rebaseline-dialog.tsx`**

Add the import (alongside `import type { Priority } from "@/lib/project";` / `import type { ProfileRole } from "@/lib/profile";`):

```ts
import { QA_LEAD_ROLES } from "@/lib/profile";
```

Change line 44 from:

```ts
  const isLead = role === "qa_lead";
```

to:

```ts
  const isLead = QA_LEAD_ROLES.includes(role);
```

- [ ] **Step 5: `src/components/allocations/assignments-table.tsx`**

Add the import (alongside `import type { Priority, Project } from "@/lib/project";` / `import type { ProfileRole } from "@/lib/profile";`):

```ts
import { QA_LEAD_ROLES } from "@/lib/profile";
```

Change line 80 from:

```ts
  const canRebaseline = role === "qa_lead" || role === "project_manager";
```

to:

```ts
  const canRebaseline = QA_LEAD_ROLES.includes(role) || role === "project_manager";
```

Change line 155 from:

```tsx
                      {role === "qa_lead" && allocation.approval_status === "approved" && (
```

to:

```tsx
                      {QA_LEAD_ROLES.includes(role) && allocation.approval_status === "approved" && (
```

- [ ] **Step 6: `src/components/allocations/bulk-assign-dialog.tsx`**

Add the import (alongside `import type { ProfileRole } from "@/lib/profile";`):

```ts
import { QA_LEAD_ROLES } from "@/lib/profile";
```

Change lines 76-80 from:

```tsx
          toast.success(
            role === "qa_lead"
              ? `Assigned ${result.created.length} QA member(s)`
              : `Proposed assignment for ${result.created.length} QA member(s) — pending QA Lead approval`,
          );
```

to:

```tsx
          toast.success(
            QA_LEAD_ROLES.includes(role)
              ? `Assigned ${result.created.length} QA member(s)`
              : `Proposed assignment for ${result.created.length} QA member(s) — pending QA Lead approval`,
          );
```

- [ ] **Step 7: `src/components/allocations/allocation-form.tsx`**

Add the import (alongside `import type { Priority, Project } from "@/lib/project";` / `import type { ProfileRole } from "@/lib/profile";`):

```ts
import { QA_LEAD_ROLES } from "@/lib/profile";
```

Change lines 81-85 from:

```tsx
        toast.success(
          role === "qa_lead"
            ? `Assigned across ${result.weeksCreated} week(s)`
            : `Proposed across ${result.weeksCreated} week(s) — pending QA Lead approval`,
        );
```

to:

```tsx
        toast.success(
          QA_LEAD_ROLES.includes(role)
            ? `Assigned across ${result.weeksCreated} week(s)`
            : `Proposed across ${result.weeksCreated} week(s) — pending QA Lead approval`,
        );
```

Change line 223 from:

```tsx
          {mutation.isPending ? "Assigning..." : role === "qa_lead" ? "Assign Resource" : "Propose Assignment"}
```

to:

```tsx
          {mutation.isPending ? "Assigning..." : QA_LEAD_ROLES.includes(role) ? "Assign Resource" : "Propose Assignment"}
```

- [ ] **Step 8: `src/components/team/team-page-content.tsx`**

Add the import (alongside `import type { ProfileRole } from "@/lib/profile";`):

```ts
import { QA_LEAD_ROLES } from "@/lib/profile";
```

Change line 15 from:

```ts
  const canWrite = role === "qa_lead";
```

to:

```ts
  const canWrite = QA_LEAD_ROLES.includes(role);
```

- [ ] **Step 9: `src/app/(app)/approvals/page.tsx`**

Add the import (alongside `import { getCurrentProfile } from "@/lib/auth";`):

```ts
import { QA_LEAD_ROLES } from "@/lib/profile";
```

Change line 8 from:

```ts
  if (!profile || profile.role !== "qa_lead") {
```

to:

```ts
  if (!profile || !QA_LEAD_ROLES.includes(profile.role)) {
```

- [ ] **Step 10: `src/app/(app)/settings/page.tsx`**

Same change as Step 9, in `src/app/(app)/settings/page.tsx`: add the `QA_LEAD_ROLES` import, change line 8 from `profile.role !== "qa_lead"` to `!QA_LEAD_ROLES.includes(profile.role)`.

- [ ] **Step 11: `src/components/app-sidebar.tsx`**

Add the import (alongside `import type { Profile, ProfileRole } from "@/lib/profile";`):

```ts
import { QA_LEAD_ROLES } from "@/lib/profile";
```

Change the Approvals item's `roles: ["qa_lead"]` (line 63) and the Settings item's `roles: ["qa_lead"]` (line 69) both to:

```ts
    roles: QA_LEAD_ROLES,
```

- [ ] **Step 12: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/components/projects/project-table.tsx src/components/projects/projects-page-content.tsx src/components/allocations/allocations-page-content.tsx src/components/allocations/rebaseline-dialog.tsx src/components/allocations/assignments-table.tsx src/components/allocations/bulk-assign-dialog.tsx src/components/allocations/allocation-form.tsx src/components/team/team-page-content.tsx "src/app/(app)/approvals/page.tsx" "src/app/(app)/settings/page.tsx" src/components/app-sidebar.tsx`
Expected: no errors.

Run this to confirm no bare `role === "qa_lead"` / `role !== "qa_lead"` / `roles: ["qa_lead"]` checks remain in `src/`:

```bash
grep -rn '=== "qa_lead"\|!== "qa_lead"\|"qa_lead"\]' src/
```

Expected: no output.

- [ ] **Step 13: Commit**

```bash
git add src/components/projects/project-table.tsx src/components/projects/projects-page-content.tsx src/components/allocations/allocations-page-content.tsx src/components/allocations/rebaseline-dialog.tsx src/components/allocations/assignments-table.tsx src/components/allocations/bulk-assign-dialog.tsx src/components/allocations/allocation-form.tsx src/components/team/team-page-content.tsx "src/app/(app)/approvals/page.tsx" "src/app/(app)/settings/page.tsx" src/components/app-sidebar.tsx
git commit -m "feat: give head_of_qa full client-side parity with qa_lead"
```

---

### Task 4: Email infrastructure and Settings toggle

**Files:**
- Modify: `package.json` (add `resend` dependency)
- Create: `src/lib/email.ts`
- Modify: `src/features/settings-schema.ts`
- Modify: `src/features/settings-action.ts`
- Modify: `src/components/settings/settings-page-content.tsx`

**Interfaces:**
- Consumes: `AppSettings.email_notifications_enabled` (Task 1).
- Produces: `sendEmail(input: { to: string; subject: string; html: string }): Promise<void>` from `@/lib/email` — Task 5's `testing-approval-action.ts` calls this exactly.

- [ ] **Step 1: Install Resend**

Run: `npm install resend`

- [ ] **Step 2: Create `src/lib/email.ts`**

```ts
import "server-only";
import { Resend } from "resend";

/**
 * Best-effort send: logs and returns on any failure (missing config or a
 * provider error) instead of throwing — a notification must never break
 * the submit/approve/reject action that triggered it.
 */
export async function sendEmail(input: { to: string; subject: string; html: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.error("Email not sent — RESEND_API_KEY or RESEND_FROM_EMAIL is not configured:", input.subject);
    return;
  }

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({ from, to: input.to, subject: input.subject, html: input.html });
  } catch (error) {
    console.error("Failed to send email:", error);
  }
}
```

- [ ] **Step 3: Extend `SettingsInput` in `src/features/settings-schema.ts`**

Change:

```ts
export const SettingsInput = z.object({
  max_parallel_projects: z.number().int().positive("Must be a positive whole number"),
});
```

to:

```ts
export const SettingsInput = z.object({
  max_parallel_projects: z.number().int().positive("Must be a positive whole number"),
  email_notifications_enabled: z.boolean(),
});
```

- [ ] **Step 4: Extend `getSettings`/`updateSettings` in `src/features/settings-action.ts`**

Change the `getSettings` select from:

```ts
    .select("max_parallel_projects")
```

to:

```ts
    .select("max_parallel_projects, email_notifications_enabled")
```

Change the `updateSettings` update payload from:

```ts
    .update({ max_parallel_projects: parsed.data.max_parallel_projects })
```

to:

```ts
    .update({
      max_parallel_projects: parsed.data.max_parallel_projects,
      email_notifications_enabled: parsed.data.email_notifications_enabled,
    })
```

- [ ] **Step 5: Add the toggle to `settings-page-content.tsx`**

Add `Checkbox` to the imports:

```ts
import { Checkbox } from "@/components/ui/checkbox";
```

Add a second piece of state next to `maxParallelProjects`:

```ts
const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState<boolean | null>(null);
```

Change the sync block from:

```ts
  if (data && maxParallelProjects === null) {
    setMaxParallelProjects(String(data.max_parallel_projects));
  }
```

to:

```ts
  if (data && maxParallelProjects === null) {
    setMaxParallelProjects(String(data.max_parallel_projects));
  }
  if (data && emailNotificationsEnabled === null) {
    setEmailNotificationsEnabled(data.email_notifications_enabled);
  }
```

Change the mutation from:

```ts
  const mutation = useMutation({
    mutationFn: () => updateSettings({ max_parallel_projects: Number(maxParallelProjects) }),
```

to:

```ts
  const mutation = useMutation({
    mutationFn: () =>
      updateSettings({
        max_parallel_projects: Number(maxParallelProjects),
        email_notifications_enabled: emailNotificationsEnabled ?? false,
      }),
```

Add a checkbox row inside the `<form>`, right before the `<Button type="submit">`:

```tsx
            <div className="flex items-center gap-2">
              <Checkbox
                id="email_notifications"
                checked={emailNotificationsEnabled ?? false}
                onCheckedChange={(checked) => setEmailNotificationsEnabled(checked === true)}
              />
              <Label htmlFor="email_notifications">Email Notifications</Label>
            </div>
```

Change the submit button's guard from:

```tsx
            <Button type="submit" disabled={mutation.isPending || maxParallelProjects === null}>
```

to:

```tsx
            <Button
              type="submit"
              disabled={mutation.isPending || maxParallelProjects === null || emailNotificationsEnabled === null}
            >
```

(without this, submitting while the email-toggle value is still loading would save `false` regardless of the row's actual current value — the same reason `maxParallelProjects === null` is already guarded).

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/email.ts src/features/settings-schema.ts src/features/settings-action.ts src/components/settings/settings-page-content.tsx`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/email.ts src/features/settings-schema.ts src/features/settings-action.ts src/components/settings/settings-page-content.tsx
git commit -m "feat: add Resend email infrastructure and notification toggle"
```

- [ ] **Step 8: Flag the Resend setup for the human partner**

Tell your human partner: "Email sending needs a Resend account — create one at resend.com, verify a sending domain, and add `RESEND_API_KEY` and `RESEND_FROM_EMAIL` to `.env.local` (documented in `.env.example`) before notifications can actually send. Everything else works without it — sends just get logged and skipped."

---

### Task 5: Submission workflow actions

**Files:**
- Create: `src/features/testing-approval-schema.ts`
- Create: `src/features/testing-approval-action.ts`

**Interfaces:**
- Consumes: `TestingDocumentSubmission`, `SubmissionStatus` (Task 1); `sendEmail` (Task 4); `getSettings` from `@/features/settings-action` (existing).
- Produces: `getTestingSubmissions(): Promise<TestingSubmissionWithProject[]>`, `submitTestingDocument(projectId: string): Promise<{ success: true }>`, `approveTestingSubmission(id: string): Promise<{ success: true }>`, `rejectTestingSubmission(id: string, input: unknown): Promise<{ success: true }>` — Task 6's page content calls all four exactly as named. `TestingSubmissionWithProject = TestingDocumentSubmission & { project_name: string }` — Task 6 renders this shape.

- [ ] **Step 1: Create `src/features/testing-approval-schema.ts`**

```ts
import { z } from "zod";

export const RejectSubmissionInput = z.object({
  comment: z.string().trim().min(1, "A comment is required to reject"),
});
export type RejectSubmissionInput = z.infer<typeof RejectSubmissionInput>;
```

- [ ] **Step 2: Create `src/features/testing-approval-action.ts`**

```ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { getSettings } from "@/features/settings-action";
import { RejectSubmissionInput } from "@/features/testing-approval-schema";
import type { TestingDocumentSubmission } from "@/lib/testing-approval";

type AdminClient = ReturnType<typeof createAdminClient>;

export type TestingSubmissionWithProject = TestingDocumentSubmission & { project_name: string };

type SubmissionRow = TestingDocumentSubmission & { projects: { name: string } | null };

export async function getTestingSubmissions(): Promise<TestingSubmissionWithProject[]> {
  await requireRole(["qa_lead", "head_of_qa", "project_manager"]);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("testing_document_submissions")
    .select("*, projects(name)")
    .order("submitted_at", { ascending: false });
  if (error) throw new Error(error.message);

  return ((data ?? []) as SubmissionRow[]).map(({ projects, ...submission }) => ({
    ...submission,
    project_name: projects?.name ?? "—",
  }));
}

export async function submitTestingDocument(projectId: string): Promise<{ success: true }> {
  const profile = await requireRole(["qa_lead"]);

  const admin = createAdminClient();

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("name, approval_status, progress_percent")
    .eq("id", projectId)
    .single();
  if (projectError || !project) throw new Error(projectError?.message ?? "Item not found");
  if (project.approval_status !== "approved") {
    throw new Error("Only an approved item can be submitted");
  }
  if (project.progress_percent !== 100) {
    throw new Error("Progress must reach 100% before submitting for approval");
  }

  const { count, error: pendingError } = await admin
    .from("testing_document_submissions")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("status", "pending");
  if (pendingError) throw new Error(pendingError.message);
  if (count && count > 0) {
    throw new Error("This item already has a pending submission");
  }

  const { error } = await admin
    .from("testing_document_submissions")
    .insert({ project_id: projectId, submitted_by: profile.id });
  if (error) throw new Error(error.message);

  await notifyHeadsOfQa(admin, project.name, profile.name);

  return { success: true };
}

export async function approveTestingSubmission(id: string): Promise<{ success: true }> {
  const profile = await requireRole(["head_of_qa"]);

  const admin = createAdminClient();

  const { data: submission, error: fetchError } = await admin
    .from("testing_document_submissions")
    .select("status, project_id, submitted_by")
    .eq("id", id)
    .single();
  if (fetchError || !submission || submission.status !== "pending") {
    throw new Error("This submission is no longer pending");
  }

  const { error } = await admin
    .from("testing_document_submissions")
    .update({ status: "approved", decided_by: profile.id, decided_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await notifySubmitter(admin, submission.project_id, submission.submitted_by, "approved", null);

  return { success: true };
}

export async function rejectTestingSubmission(id: string, input: unknown): Promise<{ success: true }> {
  const profile = await requireRole(["head_of_qa"]);

  const parsed = RejectSubmissionInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: submission, error: fetchError } = await admin
    .from("testing_document_submissions")
    .select("status, project_id, submitted_by")
    .eq("id", id)
    .single();
  if (fetchError || !submission || submission.status !== "pending") {
    throw new Error("This submission is no longer pending");
  }

  const { error } = await admin
    .from("testing_document_submissions")
    .update({
      status: "rejected",
      decided_by: profile.id,
      decided_at: new Date().toISOString(),
      rejection_comment: parsed.data.comment,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await notifySubmitter(admin, submission.project_id, submission.submitted_by, "rejected", parsed.data.comment);

  return { success: true };
}

async function notifyHeadsOfQa(admin: AdminClient, projectName: string, submittedByName: string): Promise<void> {
  if (!(await getSettings()).email_notifications_enabled) return;

  const { data: heads } = await admin
    .from("profiles")
    .select("email")
    .eq("role", "head_of_qa")
    .eq("is_active", true);

  for (const head of heads ?? []) {
    await sendEmail({
      to: head.email,
      subject: `Testing approval needed: ${projectName}`,
      html: `<p>${submittedByName} submitted <strong>${projectName}</strong> for testing document approval.</p>`,
    });
  }
}

async function notifySubmitter(
  admin: AdminClient,
  projectId: string,
  submittedBy: string,
  status: "approved" | "rejected",
  comment: string | null,
): Promise<void> {
  if (!(await getSettings()).email_notifications_enabled) return;

  const { data: project } = await admin.from("projects").select("name").eq("id", projectId).single();
  const { data: submitter } = await admin.from("profiles").select("email").eq("id", submittedBy).single();
  if (!project || !submitter) return;

  await sendEmail({
    to: submitter.email,
    subject: `Testing submission ${status}: ${project.name}`,
    html:
      status === "approved"
        ? `<p>Your testing document submission for <strong>${project.name}</strong> was approved.</p>`
        : `<p>Your testing document submission for <strong>${project.name}</strong> was rejected.</p><p>Comment: ${comment}</p>`,
  });
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/features/testing-approval-schema.ts src/features/testing-approval-action.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/testing-approval-schema.ts src/features/testing-approval-action.ts
git commit -m "feat: add testing document submission/approval server actions"
```

---

### Task 6: Shared Testing Approvals page

**Files:**
- Create: `src/components/testing-approvals/testing-approvals-page-content.tsx`
- Create: `src/components/testing-approvals/reject-submission-dialog.tsx`
- Create: `src/app/(app)/testing-approvals/page.tsx`
- Modify: `src/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: `getTestingSubmissions`, `submitTestingDocument`, `approveTestingSubmission` (Task 5, used directly in the page content); `rejectTestingSubmission` (Task 5, used inside the reject dialog); `getProjects` from `@/features/project-action` (existing); `getProfiles` from `@/features/profile-action` (existing); `SubmissionStatus` (Task 1).

- [ ] **Step 1: Create `src/components/testing-approvals/reject-submission-dialog.tsx`**

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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { rejectTestingSubmission } from "@/features/testing-approval-action";

type RejectSubmissionDialogProps = {
  submissionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RejectSubmissionDialog({ submissionId, open, onOpenChange }: RejectSubmissionDialogProps) {
  const [comment, setComment] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => rejectTestingSubmission(submissionId, { comment }),
    onSuccess: () => {
      toast.success("Submission rejected");
      queryClient.invalidateQueries({ queryKey: ["testing-submissions"] });
      setComment("");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject submission</DialogTitle>
          <DialogDescription>A comment is required so the QA Lead knows what to fix.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="reject_comment">Comment</Label>
            <Textarea id="reject_comment" value={comment} onChange={(e) => setComment(e.target.value)} required />
          </div>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={!comment.trim() || mutation.isPending}>
              {mutation.isPending ? "Rejecting..." : "Reject"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create `src/components/testing-approvals/testing-approvals-page-content.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RejectSubmissionDialog } from "@/components/testing-approvals/reject-submission-dialog";
import {
  approveTestingSubmission,
  getTestingSubmissions,
  submitTestingDocument,
} from "@/features/testing-approval-action";
import { getProfiles } from "@/features/profile-action";
import { getProjects } from "@/features/project-action";
import { formatDate } from "@/lib/format";
import type { SubmissionStatus } from "@/lib/testing-approval";
import type { ProfileRole } from "@/lib/profile";

const STATUS_BADGE_CLASS: Record<SubmissionStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
};

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

export function TestingApprovalsPageContent({ role }: { role: ProfileRole }) {
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitProjectId, setSubmitProjectId] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const isQaLead = role === "qa_lead";
  const isHeadOfQa = role === "head_of_qa";

  const { data: submissions, isLoading } = useQuery({
    queryKey: ["testing-submissions"],
    queryFn: () => getTestingSubmissions(),
  });

  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => getProfiles(),
  });
  const profileNameById = new Map((profiles ?? []).map((p) => [p.id, p.name]));

  const { data: approvedProjects } = useQuery({
    queryKey: ["projects", { approvalStatus: "approved" }],
    queryFn: () => getProjects({ approvalStatus: "approved" }),
    enabled: isQaLead,
  });

  const rows = submissions ?? [];
  const pendingProjectIds = new Set(rows.filter((s) => s.status === "pending").map((s) => s.project_id));
  const submittableProjects = (approvedProjects ?? []).filter(
    (p) => p.progress_percent === 100 && !pendingProjectIds.has(p.id),
  );

  const submitMutation = useMutation({
    mutationFn: () => submitTestingDocument(submitProjectId),
    onSuccess: () => {
      toast.success("Submitted for approval");
      queryClient.invalidateQueries({ queryKey: ["testing-submissions"] });
      setSubmitProjectId("");
      setSubmitOpen(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const approveMutation = useMutation({
    mutationFn: approveTestingSubmission,
    onSuccess: () => {
      toast.success("Submission approved");
      queryClient.invalidateQueries({ queryKey: ["testing-submissions"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const columnCount = isHeadOfQa ? 8 : 7;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Testing Approvals</h1>
          <p className="text-sm text-muted-foreground">
            Submit completed items for Head of QA sign-off and track approval history.
          </p>
        </div>
        {isQaLead && <Button onClick={() => setSubmitOpen(true)}>Submit for Approval</Button>}
      </div>

      <Card>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Project</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted By</TableHead>
                <TableHead>Submitted At</TableHead>
                <TableHead>Decided By</TableHead>
                <TableHead>Decided At</TableHead>
                <TableHead className={isHeadOfQa ? "" : "pr-6"}>Comment</TableHead>
                {isHeadOfQa && <TableHead className="pr-6 text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="py-8 text-center text-sm text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="py-8 text-center text-sm text-muted-foreground">
                    No submissions yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((submission) => (
                  <TableRow key={submission.id}>
                    <TableCell className="pl-6 text-sm font-medium">{submission.project_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_BADGE_CLASS[submission.status]}>
                        {STATUS_LABEL[submission.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {profileNameById.get(submission.submitted_by) ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(submission.submitted_at)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {submission.decided_by ? (profileNameById.get(submission.decided_by) ?? "—") : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {submission.decided_at ? formatDate(submission.decided_at) : "—"}
                    </TableCell>
                    <TableCell className={`text-sm text-muted-foreground ${isHeadOfQa ? "" : "pr-6"}`}>
                      {submission.rejection_comment ?? "—"}
                    </TableCell>
                    {isHeadOfQa && (
                      <TableCell className="pr-6 text-right">
                        {submission.status === "pending" && (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => setRejectingId(submission.id)}>
                              <X className="size-4" />
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              disabled={approveMutation.isPending}
                              onClick={() => approveMutation.mutate(submission.id)}
                            >
                              <Check className="size-4" />
                              Approve
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Submit for Approval</DialogTitle>
            <DialogDescription>
              The Head of QA will review this item's Jira/Jiva links and record a decision.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitMutation.mutate();
            }}
            className="space-y-4"
          >
            <Select value={submitProjectId} onValueChange={setSubmitProjectId}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    submittableProjects.length === 0 ? "No eligible items (must be 100% complete)" : "Select an item..."
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {submittableProjects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button type="submit" disabled={!submitProjectId || submitMutation.isPending}>
                {submitMutation.isPending ? "Submitting..." : "Submit"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {rejectingId && (
        <RejectSubmissionDialog
          submissionId={rejectingId}
          open
          onOpenChange={(o) => {
            if (!o) setRejectingId(null);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create the route `src/app/(app)/testing-approvals/page.tsx`**

```tsx
import { redirect } from "next/navigation";

import { TestingApprovalsPageContent } from "@/components/testing-approvals/testing-approvals-page-content";
import { getCurrentProfile } from "@/lib/auth";
import type { ProfileRole } from "@/lib/profile";

const ALLOWED_ROLES: ProfileRole[] = ["qa_lead", "head_of_qa", "project_manager"];

export default async function TestingApprovalsPage() {
  const profile = await getCurrentProfile();
  if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
    redirect("/dashboard");
  }
  return <TestingApprovalsPageContent role={profile.role} />;
}
```

- [ ] **Step 4: Add the sidebar entry in `src/components/app-sidebar.tsx`**

Add `FileCheck` to the `lucide-react` import list (currently `CheckSquare, ClipboardList, LayoutDashboard, ListChecks, Settings as SettingsIcon, Users`):

```ts
import {
  CheckSquare,
  ClipboardList,
  FileCheck,
  LayoutDashboard,
  ListChecks,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";
```

Add a new entry to the `ITEMS` array, right after the Approvals entry:

```ts
  {
    href: "/testing-approvals",
    label: "Testing Approvals",
    icon: FileCheck,
    roles: ["qa_lead", "head_of_qa", "project_manager"],
  },
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/components/testing-approvals/reject-submission-dialog.tsx src/components/testing-approvals/testing-approvals-page-content.tsx "src/app/(app)/testing-approvals/page.tsx" src/components/app-sidebar.tsx`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds (this is the last task touching every layer, so a full build is worth the extra confidence beyond `tsc`/`eslint`).

- [ ] **Step 6: Commit**

```bash
git add src/components/testing-approvals/reject-submission-dialog.tsx src/components/testing-approvals/testing-approvals-page-content.tsx "src/app/(app)/testing-approvals/page.tsx" src/components/app-sidebar.tsx
git commit -m "feat: add shared Testing Approvals page"
```

---

### Task 7: Manual verification against live data

**Files:** none — this task is a verification checklist, no code changes.

**Interfaces:** none.

- [ ] **Step 1: Confirm the migration has been applied**

Ask your human partner to confirm migration `0007_head_of_qa_and_testing_approvals.sql` has been run against the live Supabase project. Do not proceed with live testing until confirmed.

- [ ] **Step 2: Create a Head of QA test account**

As a `qa_lead`, open Team Management, add a new user with role "Head of QA". Confirm the role dropdown shows the new option and the user is created successfully.

- [ ] **Step 3: Confirm capability parity**

Sign in as the new Head of QA account. Confirm every page a `qa_lead` can reach is also reachable (Dashboard, Team, Project Portfolio with New Item, Allocation Tool with Add Project, Approvals, Settings) and every `qa_lead`-only action succeeds (e.g. editing a project, approving an allocation proposal).

- [ ] **Step 4: Submission workflow — the 100%-progress gate**

As a `qa_lead`, open Testing Approvals. Confirm the project picker in "Submit for Approval" excludes any approved project whose progress is below 100%. Pick a project at 100% progress and submit. Confirm the toast reads "Submitted for approval" and the row appears with status "Pending". Re-open the submit dialog — confirm the just-submitted project no longer appears in the picker (blocked while pending).

- [ ] **Step 5: Approve path**

Sign in as Head of QA, open Testing Approvals. Confirm Approve/Reject buttons appear only on the pending row. Click Approve. Confirm the toast reads "Submission approved," the row's status badge updates to "Approved," and Decided By/Decided At populate.

- [ ] **Step 6: Reject path**

As the `qa_lead`, submit the same project again (now allowed, since the prior submission is no longer pending). As Head of QA, click Reject, try submitting with an empty comment (confirm the Reject button stays disabled), then submit with a comment. Confirm the toast reads "Submission rejected," the row's status is "Rejected," and the Comment column shows the text. Confirm the project-manager account sees the same table read-only (no Submit button, no Approve/Reject buttons).

- [ ] **Step 7: Email notifications (only if Resend is configured)**

If `RESEND_API_KEY`/`RESEND_FROM_EMAIL` are set: in Settings, enable "Email Notifications," repeat Steps 4-6, and confirm the Head of QA account receives a submission-received email and the QA Lead account receives an approved/rejected email. If Resend isn't configured yet, skip this step — the toggle and UI already verified working in Steps 4-6 with notifications implicitly off (default `false`).

- [ ] **Step 8: Clean up**

Delete the test Head of QA account created in Step 2 via Team Management (deactivate or remove, matching this app's existing user-management flow). If any project's progress/status was changed during testing, restore it via the QA Lead's Edit form.
