# Testing Document Approval — Design

## Context

Today, once a project's testing is complete there's no formalized sign-off
step in the app — completion just means `progress_percent` hit 100. This
adds a lightweight approval gate on top of that: a new `head_of_qa` role
reviews each finished project (via its existing Jira/Jiva links, not a
document uploaded to this app) and records an approve/reject decision. QA
Lead and PM track the whole history on one shared page. Email notifications
are optional and globally toggleable.

## 1. Role & permissions

`ProfileRole` gains `"head_of_qa"`. A `head_of_qa` account has **every
capability `qa_lead` has today**, app-wide, with one addition (approve/reject
testing submissions) and one exception carved out specifically by this
feature (submitting a testing document stays QA-Lead-only — see §3; a Head
of QA is the reviewer, not the submitter). Outside of those two testing-
approval-specific actions, `head_of_qa` and `qa_lead` are interchangeable
everywhere in the app.

Implementation: one shared constant in `src/lib/profile.ts`:

```ts
export type ProfileRole = "qa_lead" | "qa_member" | "project_manager" | "head_of_qa";

export const QA_LEAD_ROLES: ProfileRole[] = ["qa_lead", "head_of_qa"];
```

Every existing `requireRole(["qa_lead"])` becomes `requireRole(QA_LEAD_ROLES)`.
Every existing `role === "qa_lead"` UI check becomes
`QA_LEAD_ROLES.includes(role)` (or an equivalent `isQaLeadLike(role)` helper
alongside the constant, to avoid repeating `.includes` everywhere). Full
list of touched files, gathered by grepping the current codebase for both
patterns:

- **Server actions** (`requireRole(["qa_lead"])` → `requireRole(QA_LEAD_ROLES)`):
  `allocation-action.ts` (2 sites), `approval-action.ts` (12 sites),
  `product-action.ts` (3), `profile-action.ts` (4), `project-action.ts` (3),
  `settings-action.ts` (1), `qa-group-action.ts` (3).
- **UI role checks** (`role === "qa_lead"` → `QA_LEAD_ROLES.includes(role)`):
  `project-table.tsx`, `projects-page-content.tsx`, `bulk-assign-dialog.tsx`,
  `allocation-form.tsx`, `rebaseline-dialog.tsx`, `allocations-page-content.tsx`,
  `assignments-table.tsx`, `team-page-content.tsx`.
- **Route guards** (`profile.role !== "qa_lead"` → `!QA_LEAD_ROLES.includes(profile.role)`):
  `app/(app)/approvals/page.tsx`, `app/(app)/settings/page.tsx`.
- **Sidebar nav** (`app-sidebar.tsx`): the `roles: ["qa_lead"]` arrays for
  the Approvals and Settings nav items become `roles: QA_LEAD_ROLES`.
- **Team Management** (`team-form-dialog.tsx`): role `<Select>` gets a new
  `<SelectItem value="head_of_qa">Head of QA</SelectItem>` option.

`profiles.role` DB check constraint and `ProfileRoleInput` in
`profile-schema.ts` both add `'head_of_qa'`/`"head_of_qa"` to their enums.

## 2. Data model

New table, migration `0007_head_of_qa_and_testing_approvals.sql`:

```sql
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

Writes go through the admin (service-role) client in server actions, same
as every other table in this app — no insert/update RLS policy needed.

New type `src/lib/testing-approval.ts`:

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

`AppSettings` (`src/lib/settings.ts`) gains `email_notifications_enabled: boolean`.

## 3. Submission workflow (`src/features/testing-approval-action.ts`)

```ts
export async function getTestingSubmissions(): Promise<(TestingDocumentSubmission & { project_name: string })[]>
export async function submitTestingDocument(projectId: string): Promise<{ success: true }>
export async function approveTestingSubmission(id: string): Promise<{ success: true }>
export async function rejectTestingSubmission(id: string, input: unknown): Promise<{ success: true }>
```

- `getTestingSubmissions`: `requireRole(["qa_lead", "head_of_qa", "project_manager"])`.
  Selects all submissions joined with the project's name, newest
  `submitted_at` first.
- `submitTestingDocument`: `requireRole(["qa_lead"])` — **not** `QA_LEAD_ROLES`;
  this is the one deliberate carve-out from §1 (a Head of QA reviews, they
  don't submit). Fetches the project; throws if `approval_status !==
  "approved"` ("Only an approved item can be submitted") or
  `progress_percent !== 100` ("Progress must reach 100% before submitting
  for approval") or an existing `pending` submission already exists for
  this project ("This item already has a pending submission"). Inserts a
  row (`status: "pending"`, `submitted_by: profile.id`). On success, sends
  the submission-received notification (§5) to every active `head_of_qa`.
- `approveTestingSubmission`: `requireRole(["head_of_qa"])`. Throws if the
  row isn't `pending`. Updates `status: "approved"`, `decided_by:
  profile.id`, `decided_at: now()`. Sends the decision notification (§5)
  to the submission's `submitted_by`.
- `rejectTestingSubmission`: `requireRole(["head_of_qa"])`. Input schema
  `RejectSubmissionInput = z.object({ comment: z.string().trim().min(1,
  "A comment is required to reject") })`. Throws if the row isn't
  `pending`. Updates `status: "rejected"`, `decided_by`, `decided_at`,
  `rejection_comment: parsed.data.comment`. Sends the decision
  notification (§5) to `submitted_by`.

A rejected row is never reused — the QA Lead calls `submitTestingDocument`
again for the same project, which is allowed once the prior row is no
longer `pending`, creating a second, independent history row.

## 4. Shared page — `/testing-approvals`

New route `src/app/(app)/testing-approvals/page.tsx`, guarded to
`qa_lead`, `head_of_qa`, `project_manager` (not `qa_member` — not a
stakeholder in this workflow). New sidebar entry "Testing Approvals"
(e.g. `FileCheck` icon) with the same three roles.

`src/components/testing-approvals/testing-approvals-page-content.tsx` — one
component, capabilities gated by `role` prop:

- **QA Lead**: a "Submit for Approval" button opens a small dialog with a
  project `<Select>` scoped client-side to projects that are
  `approval_status === "approved"`, `progress_percent === 100`, and have no
  existing row in the fetched submissions list with `status === "pending"`
  for that `project_id`. Submitting calls `submitTestingDocument`.
- **Project Manager**: no action controls.
- **Head of QA**: on each `pending` row, an Approve button
  (`approveTestingSubmission`) and a Reject button that opens
  `reject-submission-dialog.tsx` (a `Textarea` for the required comment,
  submitting calls `rejectTestingSubmission`).

Table columns: Project (name), Status (badge — `border-amber-200
bg-amber-50 text-amber-700` for `pending` and `border-rose-200 bg-rose-50
text-rose-700` for `rejected`, both already used elsewhere in this app;
`border-emerald-200 bg-emerald-50 text-emerald-700` for `approved`, new to
this app but consistent with its existing amber/rose/blue badge pattern),
Submitted By / Submitted At, Decided By / Decided At (em-dash when still
pending), Comment (rejection comment when present).

## 5. Email notifications

New `src/lib/email.ts`:

```ts
export async function sendEmail(input: { to: string; subject: string; html: string }): Promise<void>
```

Wraps the Resend SDK (`npm install resend`, `new
Resend(process.env.RESEND_API_KEY)`). Catches and logs (`console.error`)
any send failure rather than throwing — a notification failure must never
break the underlying submit/approve/reject action.

Two small template builders, inlined directly in `testing-approval-action.ts`
(just two functions — not worth a separate file):

```ts
function submissionReceivedEmail(projectName: string, submittedByName: string): { subject: string; html: string }
function submissionDecidedEmail(projectName: string, status: "approved" | "rejected", comment: string | null): { subject: string; html: string }
```

Example copy: submission-received subject `"Testing approval needed: {projectName}"`;
decision subject `"Testing submission {approved|rejected}: {projectName}"`,
body including the rejection comment when present.

Both `testing-approval-action.ts` functions that trigger a notification
first call `getSettings()` and skip entirely (no Resend call at all) when
`email_notifications_enabled` is `false`. On submit, recipients are every
`profiles` row with `role: "head_of_qa"` and `is_active: true`. On
approve/reject, the recipient is the single `profiles.email` for
`submitted_by`.

**Settings page** (`settings-page-content.tsx`): a new `Switch` (or
checkbox, matching this app's existing form-control components) labeled
"Email Notifications," next to the existing Max Parallel Projects field,
calling the existing `updateSettings` action (extended to accept
`email_notifications_enabled`).

**Setup requirement**: this repo has no email provider configured today.
You'll need a Resend account and API key added to `.env.local` as
`RESEND_API_KEY` before notifications can actually send — until then, the
toggle and UI work, but any send attempt fails (logged, not thrown) since
the env var is unset.

## Out of scope

- No file/document upload or storage — the Head of QA reviews via the
  project's existing `jira_link`/`jiva_link`; this feature never stores
  the testing document itself.
- No per-user notification preferences — one global on/off switch in
  Settings, matching the existing `max_parallel_projects` pattern.
- No changes to the Project Portfolio table/page — testing-approval status
  is visible only on the new `/testing-approvals` page, not as a new
  column or badge on `project-table.tsx`.
- No email delivery verification/retry — a failed send is logged and
  dropped, matching how this app treats no other background-job-style
  concerns (there's no job queue in this codebase to retry into).
