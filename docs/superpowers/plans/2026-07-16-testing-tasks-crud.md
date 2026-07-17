# Testing Tasks CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone "Testing Tasks" CRUD module (list, create, edit, delete testing tasks with QA execution metrics) to the Fina App finance tracker, unrelated to the existing finance features.

**Architecture:** Mirrors the existing `transactions` feature exactly — a Supabase table with permissive RLS, a Zod schema, `"use server"` CRUD actions, a React Query-backed list page, and shadcn/ui table + dialog components. No shared data or AI/RAG ties to `transactions`.

**Tech Stack:** Next.js (App Router, client components), Supabase (Postgres + supabase-js via `@/lib/supabase/server`), Zod, TanStack React Query, shadcn/ui (Radix), Tailwind, sonner toasts.

## Global Constraints

- No multi-tenancy / company entity — single shared list of tasks, same permissive RLS pattern (`using (true) with check (true)`) as `public.transactions`.
- No AI features — no embeddings, no semantic search, no chat integration for this module.
- `start_date`: required, defaults to today's date, editable. `due_date`: optional/nullable.
- `total_tc`, `ok_count`, `nok_count`, `na_count`, `total_execute_tc`, `total_passed_tc`: manual, non-negative-integer input fields, default `0`, **no cross-field validation** (e.g. `ok_count + nok_count + na_count` is never checked against `total_tc`).
- `% Execute TC` and `% Passed TC` are **computed on the fly, never stored**: `percentExecuted = total_execute_tc / total_tc * 100`, `percentPassed = total_passed_tc / total_tc * 100`, both `0` when `total_tc === 0` (no divide-by-zero).
- List-view table shows only the two computed percentages, not the six raw counts — raw counts are only visible/editable in the create/edit form.
- Sidebar order: Dashboard → Transactions → Testing Tasks.
- **This repo has no automated test framework** (no jest/vitest, confirmed via `package.json`) and `transactions` itself has zero automated tests — this plan does not introduce one. Per-task verification instead uses: `npx tsc --noEmit` (type-check gate), `npx eslint <changed files>` (lint gate, scoped to the files touched — the repo has pre-existing, unrelated errors in `experiments/voyage-ping.ts` and warnings elsewhere that must be ignored), and disposable `npx tsx` scratch scripts for pure-logic checks (same tool already used ad hoc in `scripts/test-search.ts`). Final behavioral correctness (DB reads/writes, full UI flow) is verified once, end-to-end, in Task 9, exactly as `transactions` was originally verified.
- Migrations in this repo are applied manually via the Supabase Dashboard SQL Editor (see header comment in `supabase/migrations/0001_init.sql`) — there is no local Supabase/CLI setup and no service-role key in `.env.local`, so no task in this plan can apply the migration programmatically.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/0005_testing_tasks.sql`

**Interfaces:**
- Produces: table `public.testing_tasks` with columns `id, title, description, status, priority, start_date, due_date, total_tc, ok_count, nok_count, na_count, total_execute_tc, total_passed_tc, created_at, updated_at` — every later task's SQL/queries depend on these exact column names and types.

- [ ] **Step 1: Write the migration file**

```sql
-- Testing Tasks — standalone feature untuk tracking progress testing aplikasi.
-- Jalankan via Supabase Dashboard → SQL Editor → paste → Run.
-- Tidak terhubung ke tabel/feature finance manapun.

create table if not exists public.testing_tasks (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  description       text,
  status            text not null default 'not_started'
                    check (status in ('not_started', 'in_progress', 'passed', 'failed', 'blocked')),
  priority          text not null default 'medium'
                    check (priority in ('low', 'medium', 'high')),
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

-- updated_at otomatis di-bump setiap UPDATE.
create or replace function public.set_testing_tasks_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists testing_tasks_set_updated_at on public.testing_tasks;

create trigger testing_tasks_set_updated_at
  before update on public.testing_tasks
  for each row
  execute function public.set_testing_tasks_updated_at();

-- RLS — permissive (single-user app, no auth UI yet), sama seperti transactions.
alter table public.testing_tasks enable row level security;

create policy "Permissive rules for all"
  on public.testing_tasks
  for all
  using (true)
  with check (true);
```

- [ ] **Step 2: Apply the migration manually**

This cannot be run from the CLI — this project has no local Supabase instance and no service-role key. Log into the Supabase Dashboard for this project → SQL Editor → paste the full contents of `supabase/migrations/0005_testing_tasks.sql` → Run.

Expected: no errors. Then open Table Editor → confirm `testing_tasks` exists with all 15 columns listed above.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0005_testing_tasks.sql
git commit -m "feat: add testing_tasks table migration"
```

---

### Task 2: Shared type + TC-percentage helper

**Files:**
- Create: `src/lib/testing-task.ts`
- Create: `src/lib/testing-task-metrics.ts`

**Interfaces:**
- Consumes: nothing (pure, no dependency on Task 1's live DB — only needs the shape).
- Produces: `TestingTask`, `TestingTaskStatus`, `TestingTaskPriority` types from `src/lib/testing-task.ts`; `computeTcPercentages(task): { percentExecuted: number; percentPassed: number }` from `src/lib/testing-task-metrics.ts`. Both are imported by Tasks 4, 6, and 7.

- [ ] **Step 1: Write the shared type**

`src/lib/testing-task.ts`:

```ts
export type TestingTaskStatus =
  | "not_started"
  | "in_progress"
  | "passed"
  | "failed"
  | "blocked";

export type TestingTaskPriority = "low" | "medium" | "high";

export type TestingTask = {
  id: string;
  title: string;
  description: string | null;
  status: TestingTaskStatus;
  priority: TestingTaskPriority;
  start_date: string;
  due_date: string | null;
  total_tc: number;
  ok_count: number;
  nok_count: number;
  na_count: number;
  total_execute_tc: number;
  total_passed_tc: number;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 2: Write the metrics helper**

`src/lib/testing-task-metrics.ts`:

```ts
import type { TestingTask } from "@/lib/testing-task";

export type TcPercentages = {
  percentExecuted: number;
  percentPassed: number;
};

/**
 * Hitung % Execute TC dan % Passed TC dari total_tc.
 * total_tc = 0 -> 0% untuk keduanya (hindari divide-by-zero).
 */
export function computeTcPercentages(
  task: Pick<TestingTask, "total_tc" | "total_execute_tc" | "total_passed_tc">,
): TcPercentages {
  if (task.total_tc === 0) {
    return { percentExecuted: 0, percentPassed: 0 };
  }
  return {
    percentExecuted: (task.total_execute_tc / task.total_tc) * 100,
    percentPassed: (task.total_passed_tc / task.total_tc) * 100,
  };
}
```

- [ ] **Step 3: Write and run a scratch verification script**

Create `scratch-verify-metrics.ts` at the **repo root** (same folder as `package.json` — this is temporary, not committed):

```ts
import { computeTcPercentages } from "@/lib/testing-task-metrics";

function assertEqual(actual: number, expected: number, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const zero = computeTcPercentages({ total_tc: 0, total_execute_tc: 0, total_passed_tc: 0 });
assertEqual(zero.percentExecuted, 0, "zero.percentExecuted");
assertEqual(zero.percentPassed, 0, "zero.percentPassed");

const partial = computeTcPercentages({ total_tc: 20, total_execute_tc: 10, total_passed_tc: 8 });
assertEqual(partial.percentExecuted, 50, "partial.percentExecuted");
assertEqual(partial.percentPassed, 40, "partial.percentPassed");

const full = computeTcPercentages({ total_tc: 10, total_execute_tc: 10, total_passed_tc: 10 });
assertEqual(full.percentExecuted, 100, "full.percentExecuted");
assertEqual(full.percentPassed, 100, "full.percentPassed");

console.log("OK: computeTcPercentages passes all cases");
```

Run: `npx tsx scratch-verify-metrics.ts`
Expected: prints `OK: computeTcPercentages passes all cases`, exits 0. If it throws, fix `testing-task-metrics.ts` and re-run.

- [ ] **Step 4: Delete the scratch script**

```bash
rm scratch-verify-metrics.ts
```

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit` — expected: same pre-existing 3 errors in `experiments/voyage-ping.ts` only, no new errors in `src/lib/testing-task.ts` or `src/lib/testing-task-metrics.ts`.

```bash
git add src/lib/testing-task.ts src/lib/testing-task-metrics.ts
git commit -m "feat: add testing task type and TC-percentage helper"
```

---

### Task 3: Zod validation schema

**Files:**
- Create: `src/features/testing-task-schema.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TestingTaskInput` (Zod schema) and `TestingTaskInput` type (via `z.infer`) — consumed by Task 4's server actions and Task 6's form dialog payload shape.

- [ ] **Step 1: Write the schema**

`src/features/testing-task-schema.ts`:

```ts
import { z } from "zod";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus format YYYY-MM-DD");

const nonNegativeInt = z
  .number()
  .int("Harus berupa bilangan bulat")
  .min(0, "Tidak boleh negatif");

/** Skema input untuk membuat/mengubah testing task. */
export const TestingTaskInput = z.object({
  title: z.string().trim().min(1, "Judul wajib diisi"),
  description: z.string().trim().optional(),
  status: z.enum(["not_started", "in_progress", "passed", "failed", "blocked"]),
  priority: z.enum(["low", "medium", "high"]),
  start_date: isoDate,
  due_date: isoDate.optional(),
  total_tc: nonNegativeInt,
  ok_count: nonNegativeInt,
  nok_count: nonNegativeInt,
  na_count: nonNegativeInt,
  total_execute_tc: nonNegativeInt,
  total_passed_tc: nonNegativeInt,
});

export type TestingTaskInput = z.infer<typeof TestingTaskInput>;
```

- [ ] **Step 2: Write and run a scratch verification script**

Create `scratch-verify-schema.ts` at the repo root:

```ts
import { TestingTaskInput } from "@/features/testing-task-schema";

const valid = TestingTaskInput.safeParse({
  title: "Login flow regression",
  description: "Check login on staging",
  status: "in_progress",
  priority: "high",
  start_date: "2026-07-16",
  due_date: "2026-07-20",
  total_tc: 20,
  ok_count: 10,
  nok_count: 2,
  na_count: 0,
  total_execute_tc: 12,
  total_passed_tc: 10,
});
if (!valid.success) {
  throw new Error(`expected valid input to pass, got: ${valid.error.message}`);
}

const missingTitle = TestingTaskInput.safeParse({
  title: "",
  status: "not_started",
  priority: "medium",
  start_date: "2026-07-16",
  total_tc: 0,
  ok_count: 0,
  nok_count: 0,
  na_count: 0,
  total_execute_tc: 0,
  total_passed_tc: 0,
});
if (missingTitle.success) {
  throw new Error("expected empty title to fail validation");
}

const negativeCount = TestingTaskInput.safeParse({
  title: "Task",
  status: "not_started",
  priority: "medium",
  start_date: "2026-07-16",
  total_tc: -1,
  ok_count: 0,
  nok_count: 0,
  na_count: 0,
  total_execute_tc: 0,
  total_passed_tc: 0,
});
if (negativeCount.success) {
  throw new Error("expected negative total_tc to fail validation");
}

const badDate = TestingTaskInput.safeParse({
  title: "Task",
  status: "not_started",
  priority: "medium",
  start_date: "16-07-2026",
  total_tc: 0,
  ok_count: 0,
  nok_count: 0,
  na_count: 0,
  total_execute_tc: 0,
  total_passed_tc: 0,
});
if (badDate.success) {
  throw new Error("expected malformed start_date to fail validation");
}

console.log("OK: TestingTaskInput passes all cases");
```

Run: `npx tsx scratch-verify-schema.ts`
Expected: prints `OK: TestingTaskInput passes all cases`, exits 0.

- [ ] **Step 3: Delete the scratch script**

```bash
rm scratch-verify-schema.ts
```

- [ ] **Step 4: Type-check and commit**

Run: `npx tsc --noEmit` — expected: only the same pre-existing `experiments/voyage-ping.ts` errors, nothing new.

```bash
git add src/features/testing-task-schema.ts
git commit -m "feat: add testing task Zod validation schema"
```

---

### Task 4: Server actions (CRUD)

**Files:**
- Create: `src/features/testing-task-action.ts`

**Interfaces:**
- Consumes: `TestingTaskInput` from `src/features/testing-task-schema.ts` (Task 3); `TestingTask`, `TestingTaskStatus`, `TestingTaskPriority` from `src/lib/testing-task.ts` (Task 2); `createClient` from `@/lib/supabase/server`; requires `public.testing_tasks` to exist (Task 1).
- Produces: `getTestingTasks({ page?, limit?, search?, status?, priority? }): Promise<{ rows: TestingTask[]; totalCount: number }>`, `createTestingTask(input: unknown): Promise<{ success: true }>`, `updateTestingTask(id: string, input: unknown): Promise<{ success: true }>`, `deleteTestingTask(id: string): Promise<{ success: true }>` — all consumed by Task 6 (form dialog) and Task 7 (table) and Task 8 (page).

- [ ] **Step 1: Write the server actions**

`src/features/testing-task-action.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { TestingTaskInput } from "@/features/testing-task-schema";
import type {
  TestingTask,
  TestingTaskPriority,
  TestingTaskStatus,
} from "@/lib/testing-task";

/**
 * Hapus testing task berdasarkan ID.
 */
export async function deleteTestingTask(id: string) {
  const supabase = await createClient();

  const { error } = await supabase.from("testing_tasks").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }

  return { success: true };
}

/**
 * Buat testing task baru. Input divalidasi dengan Zod sebelum insert.
 */
export async function createTestingTask(input: unknown) {
  const parsed = TestingTaskInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Input tidak valid");
  }

  const supabase = await createClient();

  const { error } = await supabase.from("testing_tasks").insert({
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    status: parsed.data.status,
    priority: parsed.data.priority,
    start_date: parsed.data.start_date,
    due_date: parsed.data.due_date ?? null,
    total_tc: parsed.data.total_tc,
    ok_count: parsed.data.ok_count,
    nok_count: parsed.data.nok_count,
    na_count: parsed.data.na_count,
    total_execute_tc: parsed.data.total_execute_tc,
    total_passed_tc: parsed.data.total_passed_tc,
  });

  if (error) {
    throw new Error(error.message);
  }

  return { success: true };
}

/**
 * Perbarui testing task yang sudah ada. Input divalidasi dengan Zod.
 */
export async function updateTestingTask(id: string, input: unknown) {
  const parsed = TestingTaskInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Input tidak valid");
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("testing_tasks")
    .update({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      status: parsed.data.status,
      priority: parsed.data.priority,
      start_date: parsed.data.start_date,
      due_date: parsed.data.due_date ?? null,
      total_tc: parsed.data.total_tc,
      ok_count: parsed.data.ok_count,
      nok_count: parsed.data.nok_count,
      na_count: parsed.data.na_count,
      total_execute_tc: parsed.data.total_execute_tc,
      total_passed_tc: parsed.data.total_passed_tc,
    })
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }

  return { success: true };
}

/**
 * Ambil daftar testing task dengan pagination + filter opsional.
 * Urutan: start_date desc, lalu created_at desc (tie-breaker).
 */
export async function getTestingTasks({
  page = 1,
  limit = 10,
  search = "",
  status = "",
  priority = "",
}: {
  page?: number;
  limit?: number;
  search?: string;
  status?: TestingTaskStatus | "";
  priority?: TestingTaskPriority | "";
} = {}): Promise<{
  rows: TestingTask[];
  totalCount: number;
}> {
  const supabase = await createClient();

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase.from("testing_tasks").select("*", { count: "exact" });

  const term = search.trim();
  if (term) {
    query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
  }
  if (status) {
    query = query.eq("status", status);
  }
  if (priority) {
    query = query.eq("priority", priority);
  }

  const { data, count } = await query
    .order("start_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  return { rows: (data ?? []) as TestingTask[], totalCount: count ?? 0 };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit` — expected: only the same pre-existing `experiments/voyage-ping.ts` errors, nothing new. This file cannot be exercised standalone (it uses `@/lib/supabase/server`, which calls `next/headers` `cookies()` — only valid inside a Next.js request). Its real behavior is verified end-to-end in Task 9, once the UI that calls it exists.

- [ ] **Step 3: Commit**

```bash
git add src/features/testing-task-action.ts
git commit -m "feat: add testing task CRUD server actions"
```

---

### Task 5: i18n translations + sidebar nav entry

**Files:**
- Modify: `src/i18n/translations.ts`
- Modify: `src/components/app-sidebar.tsx`

**Interfaces:**
- Produces: translation keys `nav.testingTasks`, `testingTasks.*`, `taskForm.*`, `taskDelete.*` (full list below) — consumed by Tasks 6, 7, 8. New sidebar link to `/testing-tasks`.

- [ ] **Step 1: Add English keys**

In `src/i18n/translations.ts`, in the `en` object, add this line right after `"nav.transactions": "Transactions",`:

```ts
  "nav.testingTasks": "Testing Tasks",
```

Add this block right after `"delete.toast": "Transaction deleted successfully.",` and before the closing `} satisfies Record<string, string>;`:

```ts

  "testingTasks.title": "Testing Tasks",
  "testingTasks.subtitle": "Track the progress of your application testing tasks.",
  "testingTasks.add": "Add task",
  "testingTasks.cardTitle": "Testing task list",
  "testingTasks.searchPlaceholder": "Search title or description...",
  "testingTasks.empty": "No testing tasks yet.",
  "testingTasks.loadError": "Failed to load testing tasks.",
  "testingTasks.col.title": "Title",
  "testingTasks.col.status": "Status",
  "testingTasks.col.priority": "Priority",
  "testingTasks.col.startDate": "Start date",
  "testingTasks.col.dueDate": "Due date",
  "testingTasks.col.percentExecute": "% Execute",
  "testingTasks.col.percentPassed": "% Passed",
  "testingTasks.col.actions": "Actions",
  "testingTasks.status.notStarted": "Not Started",
  "testingTasks.status.inProgress": "In Progress",
  "testingTasks.status.passed": "Passed",
  "testingTasks.status.failed": "Failed",
  "testingTasks.status.blocked": "Blocked",
  "testingTasks.priority.low": "Low",
  "testingTasks.priority.medium": "Medium",
  "testingTasks.priority.high": "High",
  "testingTasks.action.edit": "Edit",
  "testingTasks.action.delete": "Delete",
  "testingTasks.action.aria": "Testing task actions",
  "testingTasks.filter.status": "Status",
  "testingTasks.filter.allStatus": "All statuses",
  "testingTasks.filter.priority": "Priority",
  "testingTasks.filter.allPriority": "All priorities",

  "taskForm.create.title": "Add testing task",
  "taskForm.edit.title": "Edit testing task",
  "taskForm.create.desc": "Record a new testing task.",
  "taskForm.edit.desc": "Update this testing task's details.",
  "taskForm.label.title": "Title",
  "taskForm.label.description": "Description (optional)",
  "taskForm.label.status": "Status",
  "taskForm.label.priority": "Priority",
  "taskForm.label.startDate": "Start date",
  "taskForm.label.dueDate": "Due date (optional)",
  "taskForm.section.metrics": "Test case metrics",
  "taskForm.label.totalTc": "Total TC",
  "taskForm.label.okCount": "OK",
  "taskForm.label.nokCount": "NOK",
  "taskForm.label.naCount": "NA",
  "taskForm.label.totalExecuteTc": "Total Execute TC",
  "taskForm.label.totalPassedTc": "Total Passed TC",
  "taskForm.placeholder.title": "e.g. Login flow regression",
  "taskForm.placeholder.description": "e.g. Check login on staging",
  "taskForm.submit.add": "Add",
  "taskForm.submit.save": "Save",
  "taskForm.submit.adding": "Adding...",
  "taskForm.submit.saving": "Saving...",
  "taskForm.toast.created": "Testing task added successfully.",
  "taskForm.toast.updated": "Testing task updated successfully.",

  "taskDelete.title": "Delete testing task?",
  "taskDelete.desc":
    "Testing task '{name}' will be permanently deleted. This action cannot be undone.",
  "taskDelete.cancel": "Cancel",
  "taskDelete.confirm": "Delete",
  "taskDelete.deleting": "Deleting...",
  "taskDelete.toast": "Testing task deleted successfully.",
```

- [ ] **Step 2: Add matching Indonesian keys**

In the `id` object, add this line right after `"nav.transactions": "Transaksi",`:

```ts
  "nav.testingTasks": "Testing Tasks",
```

Add this block right after `"delete.toast": "Transaksi berhasil dihapus.",` and before the closing `};`:

```ts

  "testingTasks.title": "Testing Tasks",
  "testingTasks.subtitle": "Lacak progress testing aplikasi Anda.",
  "testingTasks.add": "Tambah task",
  "testingTasks.cardTitle": "Daftar testing task",
  "testingTasks.searchPlaceholder": "Cari judul atau deskripsi...",
  "testingTasks.empty": "Belum ada testing task.",
  "testingTasks.loadError": "Gagal memuat testing task.",
  "testingTasks.col.title": "Judul",
  "testingTasks.col.status": "Status",
  "testingTasks.col.priority": "Prioritas",
  "testingTasks.col.startDate": "Tanggal mulai",
  "testingTasks.col.dueDate": "Tenggat",
  "testingTasks.col.percentExecute": "% Eksekusi",
  "testingTasks.col.percentPassed": "% Lulus",
  "testingTasks.col.actions": "Aksi",
  "testingTasks.status.notStarted": "Belum Mulai",
  "testingTasks.status.inProgress": "Sedang Berjalan",
  "testingTasks.status.passed": "Lulus",
  "testingTasks.status.failed": "Gagal",
  "testingTasks.status.blocked": "Terblokir",
  "testingTasks.priority.low": "Rendah",
  "testingTasks.priority.medium": "Sedang",
  "testingTasks.priority.high": "Tinggi",
  "testingTasks.action.edit": "Edit",
  "testingTasks.action.delete": "Hapus",
  "testingTasks.action.aria": "Aksi testing task",
  "testingTasks.filter.status": "Status",
  "testingTasks.filter.allStatus": "Semua status",
  "testingTasks.filter.priority": "Prioritas",
  "testingTasks.filter.allPriority": "Semua prioritas",

  "taskForm.create.title": "Tambah testing task",
  "taskForm.edit.title": "Edit testing task",
  "taskForm.create.desc": "Catat testing task baru.",
  "taskForm.edit.desc": "Perbarui detail testing task ini.",
  "taskForm.label.title": "Judul",
  "taskForm.label.description": "Deskripsi (opsional)",
  "taskForm.label.status": "Status",
  "taskForm.label.priority": "Prioritas",
  "taskForm.label.startDate": "Tanggal mulai",
  "taskForm.label.dueDate": "Tenggat (opsional)",
  "taskForm.section.metrics": "Metrik test case",
  "taskForm.label.totalTc": "Total TC",
  "taskForm.label.okCount": "OK",
  "taskForm.label.nokCount": "NOK",
  "taskForm.label.naCount": "NA",
  "taskForm.label.totalExecuteTc": "Total Execute TC",
  "taskForm.label.totalPassedTc": "Total Passed TC",
  "taskForm.placeholder.title": "mis. Login flow regression",
  "taskForm.placeholder.description": "mis. Cek login di staging",
  "taskForm.submit.add": "Tambah",
  "taskForm.submit.save": "Simpan",
  "taskForm.submit.adding": "Menambahkan...",
  "taskForm.submit.saving": "Menyimpan...",
  "taskForm.toast.created": "Testing task berhasil ditambahkan.",
  "taskForm.toast.updated": "Testing task berhasil diperbarui.",

  "taskDelete.title": "Hapus testing task?",
  "taskDelete.desc":
    "Testing task '{name}' akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.",
  "taskDelete.cancel": "Batal",
  "taskDelete.confirm": "Hapus",
  "taskDelete.deleting": "Menghapus...",
  "taskDelete.toast": "Testing task berhasil dihapus.",
```

- [ ] **Step 3: Type-check translations**

Run: `npx tsc --noEmit` — expected: only the same pre-existing `experiments/voyage-ping.ts` errors. If `id` is missing any key that `en` has (or vice versa), TypeScript will report a type error on the `const id: Dict = { ... }` assignment — fix by matching the key lists exactly.

- [ ] **Step 4: Add the sidebar entry**

In `src/components/app-sidebar.tsx`, change the import:

```ts
import { LayoutDashboard, Receipt, Wallet } from "lucide-react";
```

to:

```ts
import { ClipboardCheck, LayoutDashboard, Receipt, Wallet } from "lucide-react";
```

Then change the `items` array:

```ts
const items: { href: string; labelKey: TranslationKey; icon: typeof Receipt }[] =
  [
    { href: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
    { href: "/transactions", labelKey: "nav.transactions", icon: Receipt },
  ];
```

to:

```ts
const items: { href: string; labelKey: TranslationKey; icon: typeof Receipt }[] =
  [
    { href: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
    { href: "/transactions", labelKey: "nav.transactions", icon: Receipt },
    { href: "/testing-tasks", labelKey: "nav.testingTasks", icon: ClipboardCheck },
  ];
```

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit` — expected: only the same pre-existing `experiments/voyage-ping.ts` errors.

```bash
git add src/i18n/translations.ts src/components/app-sidebar.tsx
git commit -m "feat: add testing tasks translations and sidebar entry"
```

---

### Task 6: Testing task form dialog

**Files:**
- Create: `src/components/testing-tasks/testing-task-form-dialog.tsx`

**Interfaces:**
- Consumes: `createTestingTask`, `updateTestingTask` from `src/features/testing-task-action.ts` (Task 4); `TestingTask`, `TestingTaskPriority`, `TestingTaskStatus` from `src/lib/testing-task.ts` (Task 2); translation keys from Task 5; shadcn/ui `Dialog`, `Input`, `Label`, `Select`, `Textarea`, `Button`.
- Produces: `TestingTaskFormDialog({ mode: "create" | "edit", open: boolean, onOpenChange: (open: boolean) => void, initialValue?: TestingTask })` — consumed by Task 7 (table, edit mode) and Task 8 (page, create mode).

- [ ] **Step 1: Write the component**

`src/components/testing-tasks/testing-task-form-dialog.tsx`:

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
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/components/i18n/language-provider";
import {
  createTestingTask,
  updateTestingTask,
} from "@/features/testing-task-action";
import type {
  TestingTask,
  TestingTaskPriority,
  TestingTaskStatus,
} from "@/lib/testing-task";

type FormState = {
  title: string;
  description: string;
  status: TestingTaskStatus;
  priority: TestingTaskPriority;
  start_date: string;
  due_date: string;
  total_tc: string;
  ok_count: string;
  nok_count: string;
  na_count: string;
  total_execute_tc: string;
  total_passed_tc: string;
};

type SubmitPayload = {
  title: string;
  description?: string;
  status: TestingTaskStatus;
  priority: TestingTaskPriority;
  start_date: string;
  due_date?: string;
  total_tc: number;
  ok_count: number;
  nok_count: number;
  na_count: number;
  total_execute_tc: number;
  total_passed_tc: number;
};

type TestingTaskFormDialogProps = {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wajib diisi saat mode "edit" — dipakai untuk pre-fill + target update. */
  initialValue?: TestingTask;
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function formFromTask(task?: TestingTask): FormState {
  return task
    ? {
        title: task.title,
        description: task.description ?? "",
        status: task.status,
        priority: task.priority,
        start_date: task.start_date,
        due_date: task.due_date ?? "",
        total_tc: String(task.total_tc),
        ok_count: String(task.ok_count),
        nok_count: String(task.nok_count),
        na_count: String(task.na_count),
        total_execute_tc: String(task.total_execute_tc),
        total_passed_tc: String(task.total_passed_tc),
      }
    : {
        title: "",
        description: "",
        status: "not_started",
        priority: "medium",
        start_date: todayISO(),
        due_date: "",
        total_tc: "0",
        ok_count: "0",
        nok_count: "0",
        na_count: "0",
        total_execute_tc: "0",
        total_passed_tc: "0",
      };
}

export function TestingTaskFormDialog({
  mode,
  open,
  onOpenChange,
  initialValue,
}: TestingTaskFormDialogProps) {
  const { t } = useTranslation();
  const isEdit = mode === "edit";

  const [form, setForm] = useState<FormState>(() => formFromTask(initialValue));

  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (payload: SubmitPayload) =>
      isEdit && initialValue
        ? updateTestingTask(initialValue.id, payload)
        : createTestingTask(payload),
    onSuccess: () => {
      toast.success(
        isEdit ? t("taskForm.toast.updated") : t("taskForm.toast.created"),
      );
      queryClient.invalidateQueries({ queryKey: ["testing-tasks"] });
      if (!isEdit) setForm(formFromTask());
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    mutation.mutate({
      title: form.title,
      description: form.description.trim() || undefined,
      status: form.status,
      priority: form.priority,
      start_date: form.start_date,
      due_date: form.due_date.trim() || undefined,
      total_tc: Number(form.total_tc),
      ok_count: Number(form.ok_count),
      nok_count: Number(form.nok_count),
      na_count: Number(form.na_count),
      total_execute_tc: Number(form.total_execute_tc),
      total_passed_tc: Number(form.total_passed_tc),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("taskForm.edit.title") : t("taskForm.create.title")}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? t("taskForm.edit.desc") : t("taskForm.create.desc")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">{t("taskForm.label.title")}</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder={t("taskForm.placeholder.title")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t("taskForm.label.description")}</Label>
            <Textarea
              id="description"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder={t("taskForm.placeholder.description")}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="status">{t("taskForm.label.status")}</Label>
              <Select
                value={form.status}
                onValueChange={(value) =>
                  setForm((f) => ({ ...f, status: value as TestingTaskStatus }))
                }
              >
                <SelectTrigger id="status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_started">
                    {t("testingTasks.status.notStarted")}
                  </SelectItem>
                  <SelectItem value="in_progress">
                    {t("testingTasks.status.inProgress")}
                  </SelectItem>
                  <SelectItem value="passed">
                    {t("testingTasks.status.passed")}
                  </SelectItem>
                  <SelectItem value="failed">
                    {t("testingTasks.status.failed")}
                  </SelectItem>
                  <SelectItem value="blocked">
                    {t("testingTasks.status.blocked")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">{t("taskForm.label.priority")}</Label>
              <Select
                value={form.priority}
                onValueChange={(value) =>
                  setForm((f) => ({ ...f, priority: value as TestingTaskPriority }))
                }
              >
                <SelectTrigger id="priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t("testingTasks.priority.low")}</SelectItem>
                  <SelectItem value="medium">
                    {t("testingTasks.priority.medium")}
                  </SelectItem>
                  <SelectItem value="high">{t("testingTasks.priority.high")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start_date">{t("taskForm.label.startDate")}</Label>
              <Input
                id="start_date"
                type="date"
                value={form.start_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, start_date: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="due_date">{t("taskForm.label.dueDate")}</Label>
              <Input
                id="due_date"
                type="date"
                value={form.due_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, due_date: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="space-y-2 border-t pt-4">
            <Label className="text-sm font-medium text-muted-foreground">
              {t("taskForm.section.metrics")}
            </Label>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="total_tc">{t("taskForm.label.totalTc")}</Label>
                <Input
                  id="total_tc"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={form.total_tc}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, total_tc: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ok_count">{t("taskForm.label.okCount")}</Label>
                <Input
                  id="ok_count"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={form.ok_count}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, ok_count: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nok_count">{t("taskForm.label.nokCount")}</Label>
                <Input
                  id="nok_count"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={form.nok_count}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, nok_count: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="na_count">{t("taskForm.label.naCount")}</Label>
                <Input
                  id="na_count"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={form.na_count}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, na_count: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="total_execute_tc">
                  {t("taskForm.label.totalExecuteTc")}
                </Label>
                <Input
                  id="total_execute_tc"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={form.total_execute_tc}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, total_execute_tc: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="total_passed_tc">
                  {t("taskForm.label.totalPassedTc")}
                </Label>
                <Input
                  id="total_passed_tc"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={form.total_passed_tc}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, total_passed_tc: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? isEdit
                  ? t("taskForm.submit.saving")
                  : t("taskForm.submit.adding")
                : isEdit
                  ? t("taskForm.submit.save")
                  : t("taskForm.submit.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type-check and commit**

Run: `npx tsc --noEmit` — expected: only the same pre-existing `experiments/voyage-ping.ts` errors, nothing new in this file.

```bash
git add src/components/testing-tasks/testing-task-form-dialog.tsx
git commit -m "feat: add testing task create/edit form dialog"
```

---

### Task 7: Testing task table

**Files:**
- Create: `src/components/testing-tasks/testing-task-table.tsx`

**Interfaces:**
- Consumes: `TestingTaskFormDialog` from Task 6; `deleteTestingTask` from Task 4; `computeTcPercentages` from Task 2; `formatDate` from `@/lib/format`; translation keys from Task 5.
- Produces: `TestingTaskTable({ rows: TestingTask[], isLoading: boolean, isError: boolean })` — consumed by Task 8 (page).

- [ ] **Step 1: Write the component**

`src/components/testing-tasks/testing-task-table.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TestingTaskFormDialog } from "@/components/testing-tasks/testing-task-form-dialog";
import { useTranslation } from "@/components/i18n/language-provider";
import { deleteTestingTask } from "@/features/testing-task-action";
import { computeTcPercentages } from "@/lib/testing-task-metrics";
import { formatDate } from "@/lib/format";
import type { TestingTask, TestingTaskPriority, TestingTaskStatus } from "@/lib/testing-task";
import type { TranslationKey } from "@/i18n/translations";

type TestingTaskTableProps = {
  rows: TestingTask[];
  isLoading: boolean;
  isError: boolean;
};

const STATUS_BADGE_CLASS: Record<TestingTaskStatus, string> = {
  not_started:
    "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-300",
  in_progress:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300",
  passed:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  failed:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300",
  blocked:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
};

const STATUS_LABEL_KEY: Record<TestingTaskStatus, TranslationKey> = {
  not_started: "testingTasks.status.notStarted",
  in_progress: "testingTasks.status.inProgress",
  passed: "testingTasks.status.passed",
  failed: "testingTasks.status.failed",
  blocked: "testingTasks.status.blocked",
};

const PRIORITY_LABEL_KEY: Record<TestingTaskPriority, TranslationKey> = {
  low: "testingTasks.priority.low",
  medium: "testingTasks.priority.medium",
  high: "testingTasks.priority.high",
};

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function TestingTaskTable({
  rows,
  isLoading,
  isError,
}: TestingTaskTableProps) {
  const { t } = useTranslation();
  const [editingTask, setEditingTask] = useState<TestingTask | null>(null);
  const [deletingTask, setDeletingTask] = useState<TestingTask | null>(null);

  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: deleteTestingTask,
    onSuccess: () => {
      toast.success(t("taskDelete.toast"));
      queryClient.invalidateQueries({ queryKey: ["testing-tasks"] });
      setDeletingTask(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("testingTasks.cardTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">{t("testingTasks.col.title")}</TableHead>
              <TableHead>{t("testingTasks.col.status")}</TableHead>
              <TableHead>{t("testingTasks.col.priority")}</TableHead>
              <TableHead>{t("testingTasks.col.startDate")}</TableHead>
              <TableHead>{t("testingTasks.col.dueDate")}</TableHead>
              <TableHead className="text-right">
                {t("testingTasks.col.percentExecute")}
              </TableHead>
              <TableHead className="text-right">
                {t("testingTasks.col.percentPassed")}
              </TableHead>
              <TableHead className="pr-6 text-right">
                {t("testingTasks.col.actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-6">
                    <Skeleton className="h-4 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-4 w-12" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-4 w-12" />
                  </TableCell>
                  <TableCell className="pr-6">
                    <Skeleton className="ml-auto size-8 rounded-md" />
                  </TableCell>
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {t("testingTasks.loadError")}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {t("testingTasks.empty")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((task) => {
                const { percentExecuted, percentPassed } = computeTcPercentages(task);
                return (
                  <TableRow key={task.id}>
                    <TableCell className="pl-6 text-sm font-medium">
                      {task.title}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={STATUS_BADGE_CLASS[task.status]}
                      >
                        {t(STATUS_LABEL_KEY[task.status])}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {t(PRIORITY_LABEL_KEY[task.priority])}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(task.start_date)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {task.due_date ? formatDate(task.due_date) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatPercent(percentExecuted)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatPercent(percentPassed)}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={t("testingTasks.action.aria")}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditingTask(task)}>
                            <Pencil className="size-4" />
                            {t("testingTasks.action.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setDeletingTask(task)}
                            className="text-rose-600 focus:text-rose-600 dark:text-rose-400 dark:focus:text-rose-400"
                          >
                            <Trash2 className="size-4" />
                            {t("testingTasks.action.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>

      {editingTask && (
        <TestingTaskFormDialog
          key={editingTask.id}
          mode="edit"
          open
          onOpenChange={(o) => {
            if (!o) setEditingTask(null);
          }}
          initialValue={editingTask}
        />
      )}

      <AlertDialog
        open={deletingTask !== null}
        onOpenChange={(o) => {
          if (!o) setDeletingTask(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("taskDelete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("taskDelete.desc", { name: deletingTask?.title ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("taskDelete.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deletingTask) deleteMutation.mutate(deletingTask.id);
              }}
            >
              {deleteMutation.isPending
                ? t("taskDelete.deleting")
                : t("taskDelete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
```

- [ ] **Step 2: Type-check and commit**

Run: `npx tsc --noEmit` — expected: only the same pre-existing `experiments/voyage-ping.ts` errors, nothing new in this file.

```bash
git add src/components/testing-tasks/testing-task-table.tsx
git commit -m "feat: add testing task table with status/priority badges"
```

---

### Task 8: List page

**Files:**
- Create: `src/app/testing-tasks/page.tsx`

**Interfaces:**
- Consumes: `TestingTaskFormDialog` (Task 6), `TestingTaskTable` (Task 7), `getTestingTasks` (Task 4), `PaginationControls` and `SearchInput` from `src/components/transactions/` (reused, unmodified), translation keys (Task 5).
- Produces: the `/testing-tasks` route.

- [ ] **Step 1: Write the page**

`src/app/testing-tasks/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/components/i18n/language-provider";
import { PaginationControls } from "@/components/transactions/pagination-controls";
import { SearchInput } from "@/components/transactions/search-input";
import { TestingTaskFormDialog } from "@/components/testing-tasks/testing-task-form-dialog";
import { TestingTaskTable } from "@/components/testing-tasks/testing-task-table";
import { getTestingTasks } from "@/features/testing-task-action";
import type { TestingTaskPriority, TestingTaskStatus } from "@/lib/testing-task";

const LIMIT = 10;

export default function TestingTasksPage() {
  const { t } = useTranslation();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TestingTaskStatus | "">("");
  const [priorityFilter, setPriorityFilter] = useState<TestingTaskPriority | "">("");
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: [
      "testing-tasks",
      { page, limit: LIMIT, search, status: statusFilter, priority: priorityFilter },
    ],
    queryFn: () =>
      getTestingTasks({
        page,
        limit: LIMIT,
        search,
        status: statusFilter,
        priority: priorityFilter,
      }),
  });

  const rows = data?.rows ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / LIMIT));

  function handleSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function handleStatusFilter(value: string) {
    setStatusFilter(value === "all" ? "" : (value as TestingTaskStatus));
    setPage(1);
  }

  function handlePriorityFilter(value: string) {
    setPriorityFilter(value === "all" ? "" : (value as TestingTaskPriority));
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("testingTasks.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("testingTasks.subtitle")}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          {t("testingTasks.add")}
        </Button>
        <TestingTaskFormDialog
          mode="create"
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-64 flex-1">
          <SearchInput
            onSearch={handleSearch}
            placeholder={t("testingTasks.searchPlaceholder")}
          />
        </div>

        <Select value={statusFilter || "all"} onValueChange={handleStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t("testingTasks.filter.status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("testingTasks.filter.allStatus")}</SelectItem>
            <SelectItem value="not_started">
              {t("testingTasks.status.notStarted")}
            </SelectItem>
            <SelectItem value="in_progress">
              {t("testingTasks.status.inProgress")}
            </SelectItem>
            <SelectItem value="passed">{t("testingTasks.status.passed")}</SelectItem>
            <SelectItem value="failed">{t("testingTasks.status.failed")}</SelectItem>
            <SelectItem value="blocked">{t("testingTasks.status.blocked")}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={priorityFilter || "all"} onValueChange={handlePriorityFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t("testingTasks.filter.priority")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("testingTasks.filter.allPriority")}</SelectItem>
            <SelectItem value="low">{t("testingTasks.priority.low")}</SelectItem>
            <SelectItem value="medium">{t("testingTasks.priority.medium")}</SelectItem>
            <SelectItem value="high">{t("testingTasks.priority.high")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <TestingTaskTable rows={rows} isLoading={isLoading} isError={isError} />

      <PaginationControls
        page={page}
        totalPages={totalPages}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
      />
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint the new module**

Run: `npx tsc --noEmit` — expected: only the same pre-existing `experiments/voyage-ping.ts` errors.
Run: `npx eslint src/app/testing-tasks src/components/testing-tasks src/features/testing-task-action.ts src/features/testing-task-schema.ts src/lib/testing-task.ts src/lib/testing-task-metrics.ts` — expected: no errors (pre-existing warnings/errors elsewhere in the repo, e.g. `src/hooks/use-mobile.ts` and `src/lib/embeddings.ts`, are out of scope and must not appear here).

- [ ] **Step 3: Commit**

```bash
git add src/app/testing-tasks/page.tsx
git commit -m "feat: add testing tasks list page"
```

---

### Task 9: End-to-end manual verification

**Files:** none (verification only).

**Interfaces:** none — this task exercises the full stack built in Tasks 1–8.

**Prerequisite:** Task 1's migration must already be applied in the Supabase Dashboard (Task 1, Step 2), and `.env.local` must have valid `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (already required for `transactions` to work).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server starts on `http://localhost:3000` with no build errors.

- [ ] **Step 2: Verify navigation**

Open `http://localhost:3000` in a browser. Confirm the sidebar shows, in order: Dashboard, Transactions, Testing Tasks. Click "Testing Tasks" → confirm it navigates to `/testing-tasks` and shows an empty state ("No testing tasks yet." / "Belum ada testing task.").

- [ ] **Step 3: Create a task and verify percentage calc**

Click "Add task". Fill in: Title = "Login flow regression", Status = "In Progress", Priority = "High", Start date = today, Total TC = 20, OK = 8, NOK = 2, NA = 0, Total Execute TC = 10, Total Passed TC = 8. Submit.
Expected: success toast, dialog closes, row appears in table with % Execute = 50% (10/20) and % Passed = 40% (8/20).

- [ ] **Step 4: Create a zero-total-TC task and verify divide-by-zero guard**

Click "Add task" again. Fill in: Title = "Smoke test placeholder", leave all TC fields at 0. Submit.
Expected: row appears with % Execute = 0% and % Passed = 0% (no error, no `NaN`/`Infinity` displayed).

- [ ] **Step 5: Edit a task**

Open the row actions menu on "Login flow regression" → Edit. Change Status to "Passed", OK to 10, NOK to 0, Total Passed TC to 10. Save.
Expected: success toast, table updates in place, % Passed becomes 50% (10/20).

- [ ] **Step 6: Verify search and filters**

Type "login" in the search box → expected: only "Login flow regression" shown. Clear search. Set the Status filter to "Passed" → expected: only "Login flow regression" shown (after Step 5's edit). Reset Status filter to "All statuses". Set Priority filter to "High" → expected: only "Login flow regression" shown. Reset to "All priorities".

- [ ] **Step 7: Verify delete**

Open row actions on "Smoke test placeholder" → Delete → confirm in the dialog.
Expected: success toast, row disappears from the table.

- [ ] **Step 8: Verify pagination (optional, only if time allows)**

Create 9 more tasks (any values) so the list exceeds 10 rows total. Confirm the pagination control shows "Page 1 of 2" (or similar) and "Next"/"Prev" navigate correctly.

- [ ] **Step 9: Clean up test data**

Delete all tasks created during this verification pass via the UI, so the table is empty again (matches the state other developers will find it in).
