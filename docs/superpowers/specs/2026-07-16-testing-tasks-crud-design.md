# Testing Tasks CRUD — Design

## Context

"Fina App" is currently a personal finance tracker (transactions, AI advisor, receipt
parsing) built on Next.js + Supabase, single-user, permissive RLS, no auth UI yet.

This feature adds a **standalone, unrelated module** — a CRUD screen for tracking the
progress of application testing tasks within a company. It shares the app's tech stack,
auth/DB connection, and UI conventions, but has no data or UI ties to the finance
features (no shared tables, no AI/RAG/chat integration).

Scope decisions made during brainstorming:
- No multi-tenancy / company entity. "Company" in the request is descriptive of the use
  case, not a data model requirement — single shared list of tasks, same permissive
  pattern `transactions` already uses.
- No AI features (no embeddings, no semantic search, no chat awareness) — plain CRUD.

## Data model

New table `public.testing_tasks`, migration `supabase/migrations/0005_testing_tasks.sql`:

```sql
create table public.testing_tasks (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  description       text,
  status            text not null default 'not_started'
                    check (status in ('not_started','in_progress','passed','failed','blocked')),
  priority          text not null default 'medium'
                    check (priority in ('low','medium','high')),
  start_date        date not null default current_date,
  due_date          date,
  total_tc          integer not null default 0 check (total_tc >= 0),
  ok_count          integer not null default 0 check (ok_count >= 0),
  nok_count         integer not null default 0 check (nok_count >= 0),
  na_count          integer not null default 0 check (na_count >= 0),
  total_execute_tc  integer not null default 0 check (total_execute_tc >= 0),
  total_passed_tc   integer not null default 0 check (total_passed_tc >= 0),
  created_at        timestamptz not null default timezone('utc', now()),
  updated_at        timestamptz not null default timezone('utc', now())
);

create index if not exists testing_tasks_start_date_idx
  on public.testing_tasks (start_date desc);

alter table public.testing_tasks enable row level security;

create policy "Permissive rules for all"
  on public.testing_tasks
  for all
  using (true)
  with check (true);
```

Notes:
- `start_date` is **required**, defaults to today's date at creation, editable afterward.
- `due_date` is optional/nullable — no target end date required.
- `total_tc`, `ok_count`, `nok_count`, `na_count`, `total_execute_tc`, `total_passed_tc` are
  all **manual input fields** — non-negative integers, default 0, no cross-field
  consistency checks (e.g. `ok_count + nok_count + na_count` is not constrained to equal
  `total_tc`). Whoever fills the form owns the numbers; the app trusts them.
- `% Execute TC` and `% Passed TC` are **not stored** — computed on the fly wherever
  displayed: `% Execute TC = total_execute_tc / total_tc` and
  `% Passed TC = total_passed_tc / total_tc` (both `0%` when `total_tc` is `0`, avoiding
  divide-by-zero).
- `updated_at` is bumped via a trigger (`set updated_at = now()` before update), following
  standard Postgres practice — `transactions` doesn't have this column, but a task-progress
  table benefits from tracking last-modified time.

## Architecture / files

Mirrors the existing `transactions` feature structure.

**New files:**
- `supabase/migrations/0005_testing_tasks.sql` — table, index, RLS policy, `updated_at` trigger
- `src/lib/testing-task.ts` — shared `TestingTask` type (id, title, description, status,
  priority, start_date, due_date, total_tc, ok_count, nok_count, na_count,
  total_execute_tc, total_passed_tc, created_at, updated_at)
- `src/features/testing-task-schema.ts` — Zod `TestingTaskInput`:
  - `title`: string, trimmed, min 1
  - `description`: string, trimmed, optional
  - `status`: enum of the 5 values, default `"not_started"`
  - `priority`: enum of the 3 values, default `"medium"`
  - `start_date`: `YYYY-MM-DD` string, required
  - `due_date`: `YYYY-MM-DD` string, optional
  - `total_tc`, `ok_count`, `nok_count`, `na_count`, `total_execute_tc`, `total_passed_tc`:
    non-negative integers, default 0, no cross-field validation between them
- `src/lib/testing-task-metrics.ts` — small pure helper `computeTcPercentages(task)` →
  `{ percentExecuted, percentPassed }`, used by both the table and (if needed) form
  preview; keeps the divide-by-zero guard in one place instead of duplicated in UI code.
- `src/features/testing-task-action.ts` — server actions (`"use server"`), following the
  `features/action.ts` pattern (Zod validation before DB call, throw on error):
  - `getTestingTasks({ page, limit, search, status, priority })` — pagination + search
    (title/description `ilike`) + optional status/priority filters, ordered by
    `start_date desc, created_at desc`
  - `createTestingTask(input)`
  - `updateTestingTask(id, input)`
  - `deleteTestingTask(id)`
- `src/app/testing-tasks/page.tsx` — list page (client component, mirrors
  `app/transactions/page.tsx`): header + "Add task" button, search input, status/priority
  filter dropdowns (local state, no URL/dashboard drill-through), table, pagination.
- `src/components/testing-tasks/testing-task-table.tsx` — table with status/priority
  badges, edit/delete dropdown per row, delete confirmation `AlertDialog` — mirrors
  `TransactionTable`.
- `src/components/testing-tasks/testing-task-form-dialog.tsx` — create/edit dialog form —
  mirrors `TransactionFormDialog`.

**Reused as-is (no duplication):**
- `src/components/transactions/pagination-controls.tsx` — fully generic, imported directly.
- `src/components/transactions/search-input.tsx` — accepts a `placeholder` override,
  imported directly with a testing-tasks-specific placeholder.

**Edited files:**
- `src/components/app-sidebar.tsx` — add nav entry "Testing Tasks" (icon `ClipboardCheck`
  from lucide-react), positioned after "Transactions".
- `src/i18n/translations.ts` — add new key namespaces `testingTasks.*`, `taskForm.*`,
  `taskDelete.*`, `nav.testingTasks` (EN + ID). Existing `form.*` and `delete.*` keys hold
  transaction-specific text (e.g. `"delete.title": "Delete transaction?"`) despite generic
  names, so new keys are needed rather than reusing them.

## UI/UX

- **List page** (`/testing-tasks`): title + subtitle header, "Add task" button (opens
  create dialog), search bar (title/description), status filter dropdown, priority filter
  dropdown, table, pagination (10 rows/page).
- **Table columns**: Title, Status (colored badge per state), Priority (badge), Start date,
  Due date (— if unset), **% Execute** (computed, e.g. "60%"), **% Passed** (computed, e.g.
  "45%"), Actions (edit/delete dropdown menu). Raw counts (Total TC, OK, NOK, NA, Total
  Execute TC, Total Passed TC) are not shown as table columns — only in the create/edit
  form — to keep the list view readable.
- **Status badge colors**: Not Started = gray, In Progress = blue, Passed = green,
  Failed = red, Blocked = amber.
- **Form dialog** (create/edit): Title (text, required), Description (textarea, optional),
  Status (select, default "Not Started"), Priority (select, default "Medium"), Start date
  (date input, required, defaults to today on create), Due date (date input, optional),
  and a "Test case metrics" section with six number inputs (non-negative integers, default
  0, no cross-field validation): Total TC, OK, NOK, NA, Total Execute TC, Total Passed TC.
- **Delete**: `AlertDialog` confirmation keyed off task title, same pattern as
  `TransactionTable`'s delete flow.
- **Sidebar**: new "Testing Tasks" entry between "Transactions" and (none) — order is
  Dashboard → Transactions → Testing Tasks.
- No dashboard/chart integration; no AI chat awareness of this feature.

## Testing / verification

- Manual verification via the `run` skill: start dev server, create/edit/delete a task
  through the UI, confirm search and status/priority filters narrow results, confirm
  pagination works past 10 rows, confirm validation errors surface (empty title, missing
  start date) as toasts, confirm % Execute / % Passed render correctly including the
  `total_tc = 0` case (shows 0%, no divide-by-zero error).
- No automated test suite exists in this repo currently (none for `transactions` either) —
  consistent with existing project conventions, no new test infra is introduced here.
