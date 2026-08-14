# Project Schedule Import (Excel Upload) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let QA Lead, Head of QA, and Project Manager users upload an `.xlsx` file of project name + start/end dates, turning each row into an approval-gated proposal (new project proposal or rebaseline proposal) using the app's existing approval mechanisms — never a direct live change.

**Architecture:** A new server action (`importProjectSchedule`) parses the uploaded file with `exceljs` and, per row, either inserts a `approval_status: "pending"` project (name not found) or stages `proposed_start_date`/`proposed_end_date`/`proposed_total_working_days` on a matched existing project (same columns the existing rebaseline flow already uses). A new dialog component drives the upload and shows a per-row results table. No database schema changes.

**Tech Stack:** Next.js Server Actions, Supabase (admin client), `exceljs` (new dependency), existing shadcn/ui components (`Dialog`, `Table`, `Badge`, `Button`).

## Global Constraints

- No automated test suite exists in this repo — verification is `npx tsc --noEmit` plus manual QA, per established project convention. Every task ends with a `tsc --noEmit` check instead of a test run.
- Every row-level failure must be non-fatal — one bad row must never abort the rest of the batch.
- The same approval-gate rule applies regardless of who uploads (QA Lead, Head of QA, or PM) — no role gets a fast path to a live change.
- Reuse existing helpers instead of duplicating logic: `weekdaysBetween` from `src/lib/load.ts` for working-day counts, `requireRole` from `src/lib/auth.ts` for the role gate, `createAdminClient` from `src/lib/supabase/admin.ts` for all writes.
- Full design context: `docs/superpowers/specs/2026-08-14-project-schedule-import-design.md`.

---

### Task 1: Add `exceljs` and generate the upload template

**Files:**
- Modify: `package.json` (new dependency)
- Create: `scripts/generate-project-schedule-template.ts`
- Create (generated, then committed): `public/templates/project-schedule-template.xlsx`

**Interfaces:**
- Produces: a committed static file at `public/templates/project-schedule-template.xlsx` that Task 3's dialog links to directly via `<a href="/templates/project-schedule-template.xlsx" download>`.

- [ ] **Step 1: Install the dependency**

Run: `npm install exceljs`

Expected: `package.json` and `package-lock.json` gain an `exceljs` entry.

- [ ] **Step 2: Create the template-generation script**

Create `scripts/generate-project-schedule-template.ts`:

```ts
import ExcelJS from "exceljs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

async function main() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Schedule");

  sheet.columns = [
    { header: "Project Name", key: "name", width: 40 },
    { header: "Start Date", key: "start", width: 16, style: { numFmt: "yyyy-mm-dd" } },
    { header: "End Date", key: "end", width: 16, style: { numFmt: "yyyy-mm-dd" } },
  ];
  sheet.getRow(1).font = { bold: true };

  const outputDir = path.join(process.cwd(), "public", "templates");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "project-schedule-template.xlsx");
  await workbook.xlsx.writeFile(outputPath);
  console.log(`Wrote template to ${outputPath}`);
}

main();
```

- [ ] **Step 3: Run the script to generate the template**

Run: `npx tsx scripts/generate-project-schedule-template.ts`

Expected: console logs the output path, and `public/templates/project-schedule-template.xlsx` exists.

- [ ] **Step 4: Sanity-check the generated file**

Run: `npx tsx -e "import('exceljs').then(async ({default: E}) => { const wb = new E.Workbook(); await wb.xlsx.readFile('public/templates/project-schedule-template.xlsx'); console.log(wb.worksheets[0].getRow(1).values); })"`

Expected: prints something like `[ <1 empty item>, 'Project Name', 'Start Date', 'End Date' ]` confirming the header row round-trips correctly.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/generate-project-schedule-template.ts public/templates/project-schedule-template.xlsx
git commit -m "chore: add exceljs and generate the project schedule import template"
```

---

### Task 2: Server action — parse and reconcile uploaded rows

**Files:**
- Create: `src/features/project-import-action.ts`

**Interfaces:**
- Consumes: `weekdaysBetween(startDate: string, endDate: string): number` from `@/lib/load`; `requireRole(allowed: ProfileRole[]): Promise<Profile>` from `@/lib/auth`; `createAdminClient()` from `@/lib/supabase/admin`; `QA_LEAD_ROLES: ProfileRole[]` from `@/lib/profile`.
- Produces (consumed by Task 3):
  ```ts
  export type ImportRowOutcome = "created" | "staged" | "skipped" | "error";
  export type ImportRowResult = {
    row: number;
    projectName: string;
    outcome: ImportRowOutcome;
    detail: string;
  };
  export type ImportProjectScheduleResult = { rows: ImportRowResult[] };
  export async function importProjectSchedule(file: File): Promise<ImportProjectScheduleResult>;
  ```

- [ ] **Step 1: Write the action**

Create `src/features/project-import-action.ts`:

```ts
"use server";

import ExcelJS from "exceljs";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { weekdaysBetween } from "@/lib/load";
import { QA_LEAD_ROLES } from "@/lib/profile";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type ImportRowOutcome = "created" | "staged" | "skipped" | "error";

export type ImportRowResult = {
  row: number;
  projectName: string;
  outcome: ImportRowOutcome;
  detail: string;
};

export type ImportProjectScheduleResult = {
  rows: ImportRowResult[];
};

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    if ("richText" in value) {
      return (value.richText as { text: string }[]).map((t) => t.text).join("").trim();
    }
    if ("text" in value) {
      return String((value as { text: unknown }).text).trim();
    }
  }
  return String(value).trim();
}

function parseExcelDate(value: ExcelJS.CellValue): string | null {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const epoch = Date.UTC(1899, 11, 30);
    const date = new Date(epoch + value * 86400000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  return null;
}

export async function importProjectSchedule(file: File): Promise<ImportProjectScheduleResult> {
  const actor = await requireRole([...QA_LEAD_ROLES, "project_manager"]);

  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Please upload an .xlsx file");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("File is too large (max 5 MB)");
  }

  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new Error("Couldn't read this file — make sure it's a valid .xlsx workbook");
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("The workbook has no worksheets");
  }

  const admin = createAdminClient();
  const results: ImportRowResult[] = [];

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const name = cellText(row.getCell(1).value);
    const startRaw = row.getCell(2).value;
    const endRaw = row.getCell(3).value;

    if (!name && startRaw == null && endRaw == null) {
      continue;
    }

    if (!name) {
      results.push({ row: rowNumber, projectName: "", outcome: "error", detail: "Project Name is required" });
      continue;
    }

    const startDate = parseExcelDate(startRaw);
    const endDate = parseExcelDate(endRaw);
    if (!startDate || !endDate) {
      results.push({
        row: rowNumber,
        projectName: name,
        outcome: "error",
        detail: "Start Date / End Date is missing or invalid",
      });
      continue;
    }
    if (endDate < startDate) {
      results.push({ row: rowNumber, projectName: name, outcome: "error", detail: "End Date is before Start Date" });
      continue;
    }

    const { data: existing, error: lookupError } = await admin
      .from("projects")
      .select("id, approval_status, start_date, end_date, priority, proposed_start_date")
      .eq("name", name)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lookupError) {
      results.push({ row: rowNumber, projectName: name, outcome: "error", detail: lookupError.message });
      continue;
    }

    const treatAsNew = !existing || existing.approval_status === "rejected";

    if (treatAsNew) {
      const { error: insertError } = await admin.from("projects").insert({
        name,
        start_date: startDate,
        end_date: endDate,
        total_working_days: weekdaysBetween(startDate, endDate),
        item_type: "project",
        status: "to_do",
        priority: "medium",
        progress_percent: 0,
        jira_link: "",
        jiva_link: "",
        approval_status: "pending",
        proposed_by: actor.id,
      });
      if (insertError) {
        results.push({ row: rowNumber, projectName: name, outcome: "error", detail: insertError.message });
        continue;
      }
      results.push({ row: rowNumber, projectName: name, outcome: "created", detail: "New project proposal created" });
      continue;
    }

    if (existing.proposed_start_date !== null) {
      results.push({ row: rowNumber, projectName: name, outcome: "skipped", detail: "Already has a pending change" });
      continue;
    }

    if (existing.start_date === startDate && existing.end_date === endDate) {
      results.push({ row: rowNumber, projectName: name, outcome: "skipped", detail: "No change" });
      continue;
    }

    const { error: updateError } = await admin
      .from("projects")
      .update({
        proposed_start_date: startDate,
        proposed_end_date: endDate,
        proposed_total_working_days: weekdaysBetween(startDate, endDate),
        proposed_priority: existing.priority,
        change_proposed_by: actor.id,
        change_requested_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (updateError) {
      results.push({ row: rowNumber, projectName: name, outcome: "error", detail: updateError.message });
      continue;
    }
    results.push({ row: rowNumber, projectName: name, outcome: "staged", detail: "Rebaseline proposal staged" });
  }

  return { rows: results };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors. (`ExcelJS.CellValue` used as a type off the default import is confirmed to work — verified against `exceljs@4.4.0`'s bundled type declarations before writing this plan.)

- [ ] **Step 3: Lint**

Run: `npx eslint src/features/project-import-action.ts`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/project-import-action.ts
git commit -m "feat: add server action to parse and reconcile an uploaded project schedule"
```

---

### Task 3: Import dialog + wire into the Project Portfolio page

**Files:**
- Create: `src/components/projects/import-schedule-dialog.tsx`
- Modify: `src/components/projects/projects-page-content.tsx`

**Interfaces:**
- Consumes: `importProjectSchedule(file: File): Promise<ImportProjectScheduleResult>` and `ImportRowResult` from Task 2's `@/features/project-import-action`.

- [ ] **Step 1: Write the dialog component**

Create `src/components/projects/import-schedule-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { importProjectSchedule, type ImportRowResult } from "@/features/project-import-action";

const OUTCOME_LABEL: Record<ImportRowResult["outcome"], string> = {
  created: "Created",
  staged: "Staged",
  skipped: "Skipped",
  error: "Error",
};

const OUTCOME_BADGE_CLASS: Record<ImportRowResult["outcome"], string> = {
  created: "border-emerald-200 bg-emerald-50 text-emerald-700",
  staged: "border-blue-200 bg-blue-50 text-blue-700",
  skipped: "border-slate-200 bg-slate-50 text-slate-700",
  error: "border-rose-200 bg-rose-50 text-rose-700",
};

type ImportScheduleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ImportScheduleDialog({ open, onOpenChange }: ImportScheduleDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [results, setResults] = useState<ImportRowResult[] | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (f: File) => importProjectSchedule(f),
    onSuccess: (result) => {
      setResults(result.rows);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setFile(null);
      setResults(null);
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Schedule</DialogTitle>
          <DialogDescription>
            Upload an .xlsx file with Project Name, Start Date, and End Date columns. Every row becomes a
            proposal awaiting approval — nothing is added or changed until a QA Lead or Head of QA approves it.
          </DialogDescription>
        </DialogHeader>

        {results ? (
          <>
            <div className="max-h-80 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Project Name</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                        No rows found in this file.
                      </TableCell>
                    </TableRow>
                  ) : (
                    results.map((r) => (
                      <TableRow key={r.row}>
                        <TableCell className="text-sm tabular-nums">{r.row}</TableCell>
                        <TableCell className="text-sm">{r.projectName || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={OUTCOME_BADGE_CLASS[r.outcome]}>
                            {OUTCOME_LABEL[r.outcome]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.detail}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <DialogFooter>
              <Button onClick={() => handleClose(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <a
              href="/templates/project-schedule-template.xlsx"
              download
              className="text-sm text-primary underline underline-offset-4"
            >
              Download template
            </a>
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
            <DialogFooter>
              <Button disabled={!file || mutation.isPending} onClick={() => file && mutation.mutate(file)}>
                {mutation.isPending ? "Uploading..." : "Upload"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire the button into the Project Portfolio page**

In `src/components/projects/projects-page-content.tsx`:

Add to the imports:
```tsx
import { Upload } from "lucide-react"; // add to the existing lucide-react import line
import { ImportScheduleDialog } from "@/components/projects/import-schedule-dialog";
```

Add state near the other dialog-open flags (`createOpen`, `proposeOpen`):
```tsx
const [importOpen, setImportOpen] = useState(false);
```

Add the button in the header row, after the existing "New Item" / "Propose Item" buttons:
```tsx
{(QA_LEAD_ROLES.includes(role) || role === "project_manager") && (
  <Button variant="outline" onClick={() => setImportOpen(true)}>
    <Upload className="size-4" />
    Import Schedule
  </Button>
)}
```

Render the dialog near the other dialogs at the bottom of the component:
```tsx
<ImportScheduleDialog open={importOpen} onOpenChange={setImportOpen} />
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Lint**

Run: `npx eslint src/components/projects/import-schedule-dialog.tsx src/components/projects/projects-page-content.tsx`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/projects/import-schedule-dialog.tsx src/components/projects/projects-page-content.tsx
git commit -m "feat: add Import Schedule dialog to the Project Portfolio page"
```

---

### Task 4: Manual QA pass

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server and sign in as a Project Manager**

Run: `npm run dev`, sign in, go to Project Portfolio.

- [ ] **Step 2: New-project row**

Download the template, add one row with a project name that doesn't exist yet plus valid Start/End dates, upload it. Expected: results table shows `Created` / "New project proposal created". Switch to a QA Lead/Head of QA login → Approvals page → Project Proposals card shows the new item → Approve → project appears in the portfolio with the uploaded dates.

- [ ] **Step 3: Rebaseline row**

Upload a file with a row whose Project Name matches an existing **approved** project but with different dates. Expected: `Staged` / "Rebaseline proposal staged"; that project now shows the "Rebaseline Pending" badge in the portfolio table; Approvals page's Project Change card shows it; Approve → project's dates update to the uploaded ones.

- [ ] **Step 4: No-change and already-pending rows**

Re-upload the same file from Step 3 immediately (before approving) → expect `Skipped` / "Already has a pending change". After approving, re-upload the identical row again → expect `Skipped` / "No change".

- [ ] **Step 5: Bad rows**

Add a row with an empty Project Name, and a row with garbage text in the Start Date cell. Upload. Expected: both report `Error` with a clear reason; any other valid rows in the same file still process normally.

- [ ] **Step 6: Bad file**

Try uploading a `.png` or `.csv` file. Expected: a single toast error ("Please upload an .xlsx file"), no results table.

- [ ] **Step 7: Role visibility**

Confirm the "Import Schedule" button is visible for Project Manager, QA Lead, and Head of QA, and absent for a QA Member login.

- [ ] **Step 8: Report results**

Note any failures back before considering this feature done — this task has no automated pass/fail, it's the actual acceptance check for the feature.
