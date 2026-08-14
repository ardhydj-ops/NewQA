# Project Schedule Import (Excel Upload) — Design

## Summary

QA Lead, Head of QA, and Project Manager users can upload an `.xlsx` file
containing a project name + schedule (start/end date) for one or more
projects. Every row is turned into an approval-gated proposal — never a
live change — using the app's existing approval mechanisms:

- A name that doesn't match any existing project becomes a **new pending
  project proposal** (the same `approval_status: "pending"` path a Project
  Manager's "Propose Item" already uses).
- A name that matches an existing project becomes a **rebaseline
  proposal** (the same `proposed_start_date`/`proposed_end_date`/
  `proposed_total_working_days` staging columns the existing "Project
  Change" flow already uses).

This applies uniformly regardless of who uploads the file — even a QA
Lead's own upload goes through Approval rather than writing straight to
the live portfolio, because a bulk import carries more risk of typos/bad
rows than a single manual entry.

No database schema changes are required. No external services (no Azure
AD, no Microsoft Graph, no cron) — this replaces the earlier
SharePoint-sync idea with a plain on-demand file upload.

## Background / History

This spec originally targeted a weekly automated pull from a SharePoint
Excel file via Microsoft Graph API (Azure AD app-only auth + Vercel Cron).
That approach was dropped in favor of a manual upload — same downstream
reconciliation logic, simpler mechanism, no external auth dependency.

## Architecture

```
[Import Schedule dialog] --(FormData: file)--> [importProjectSchedule server action]
                                                        |
                                                        v
                                          parse .xlsx rows (exceljs)
                                                        |
                                                        v
                                  for each row: match existing project by name
                                        /                                \
                          no match found                         match found
                                |                                        |
                    insert new project row                   stage proposed_* columns
                    approval_status: "pending"                (same as Project Change flow)
                    proposed_by: uploader
                                \                                        /
                                  \                                    /
                                    -> existing Approvals page (unchanged)
```

## Components

### 1. Template file — `public/templates/project-schedule-template.xlsx`

A static `.xlsx` with a header row and no data rows, generated once via a
one-off script (`scripts/generate-project-schedule-template.ts`, using
`exceljs`) and committed as a binary asset. Columns, in this fixed order:

| Project Name | Start Date | End Date |
|---|---|---|

Column B and C are formatted as dates in the template so Excel doesn't
silently store user-entered dates as text.

### 2. `src/features/project-import-action.ts` (new)

```ts
export type ImportRowOutcome = "created" | "staged" | "skipped" | "error";

export type ImportRowResult = {
  row: number; // 1-based spreadsheet row number (header = row 1)
  projectName: string;
  outcome: ImportRowOutcome;
  detail: string; // human-readable reason, e.g. "New project proposal created"
};

export type ImportProjectScheduleResult = {
  rows: ImportRowResult[];
};

export async function importProjectSchedule(formData: FormData): Promise<ImportProjectScheduleResult>;
```

- `requireRole([...QA_LEAD_ROLES, "project_manager"])` — same three roles
  that can already create or propose portfolio items.
- Reads the uploaded `File` from `formData.get("file")`; rejects (single
  top-level error, no per-row processing) if: missing, not `.xlsx`
  (checked by extension + MIME type), or over 5 MB.
- Parses via `exceljs` (`Workbook#xlsx.load(buffer)`), reads the first
  worksheet, iterates rows from row 2 onward (row 1 = header, skipped).
- A completely blank row (no project name) is silently skipped — not
  counted as an error — so trailing empty template rows don't clutter
  results.
- Per-row validation, independent of other rows (best-effort — one bad
  row never aborts the rest):
  - Project Name: non-empty after trim.
  - Start Date / End Date: must resolve to a valid calendar date. Excel
    cells arrive from `exceljs` as either a `Date` object (date-formatted
    cell) or a number (serial date) or a string — all three are handled;
    anything else is an error for that row.
  - End Date must be on or after Start Date.
  - Any failed check → `outcome: "error"`, `detail` explains which check
    failed, row is skipped, loop continues.
- Reconciliation (using the admin Supabase client, same pattern as every
  other write in `project-action.ts` / `approval-action.ts`):
  - Look up the **most recent** project row with an exact name match
    (`.eq("name", name).order("created_at", { ascending: false }).limit(1)`),
    regardless of `approval_status`.
  - **No match, or the match's `approval_status` is `"rejected"`** → treat
    as a new project. Insert:
    ```
    name, start_date, end_date,
    total_working_days: weekdaysBetween(start_date, end_date),
    item_type: "project", status: "to_do", priority: "medium",
    progress_percent: 0, jira_link: "", jiva_link: "",
    approval_status: "pending", proposed_by: actor.id
    ```
    No `project_products` rows (empty products — filled in later, either
    by the QA Lead editing after approval, or left empty; `product_ids`
    is not required by `approveProjectProposal`).
    `outcome: "created"`, `detail: "New project proposal created"`.
  - **Match found, `approval_status` is `"pending"` or `"approved"`, and
    it already has a pending change** (`proposed_start_date !== null`) →
    `outcome: "skipped"`, `detail: "Already has a pending change"`.
  - **Match found, dates identical to the row** (`start_date` and
    `end_date` both equal the existing project's) → `outcome: "skipped"`,
    `detail: "No change"`.
  - **Match found, dates differ, no pending change** → update the
    matched project row:
    ```
    proposed_start_date, proposed_end_date,
    proposed_total_working_days: weekdaysBetween(start_date, end_date),
    proposed_priority: <matched project's current priority, unchanged>,
    change_proposed_by: actor.id,
    change_requested_at: now()
    ```
    `outcome: "staged"`, `detail: "Rebaseline proposal staged"`.
- Returns `{ rows: ImportRowResult[] }` covering every non-blank row
  processed (errors included), in spreadsheet order.

### 3. `src/components/projects/import-schedule-dialog.tsx` (new)

- A `Dialog` (mirrors the style of `propose-project-dialog.tsx`) with:
  - A link/button: "Download template" → `<a href="/templates/project-schedule-template.xlsx" download>`.
  - A native `<input type="file" accept=".xlsx">`.
  - "Upload" button, disabled until a file is chosen; disabled + shows
    "Uploading..." while the mutation is in flight.
- On success, replaces the upload form in-place with a results table:
  Row | Project Name | Outcome badge (Created / Staged / Skipped / Error)
  | Detail. A "Done" button closes the dialog and invalidates the
  `["projects"]` react-query cache (so any newly created pending
  proposals are reflected if the QA Lead flips to the Approvals page).
- On a top-level failure (bad file type, empty file, unreadable
  workbook), shows a single error message via `toast.error` and keeps the
  form open for retry — no results table in this case.

### 4. `src/components/projects/projects-page-content.tsx` (modify)

Add an "Import Schedule" button next to "New Item" / "Propose Item",
visible whenever either of those is
(`QA_LEAD_ROLES.includes(role) || role === "project_manager"`), opening
`ImportScheduleDialog`.

### 5. `package.json` (modify)

Add `exceljs` as a dependency (used both by the server action and by the
one-off template-generation script).

## Data Flow Summary

```
Upload .xlsx
  -> importProjectSchedule (server action, admin client, no schema migration)
     -> per row: validate -> match by name -> insert pending project OR stage proposed_* columns
  -> returns per-row outcomes
  -> dialog shows results table
  -> (separately, later) Head of QA / QA Lead reviews via existing Approvals page
     -> Project Proposals card (new projects) / Project Change card (rebaselines)
     -> Approve or Reject, exactly as today
```

## Error Handling

- Row-level errors never abort the batch — every row gets an outcome.
- Top-level errors (bad file, unreadable workbook, wrong role) abort
  before any row is processed and surface as a single toast, matching
  the pattern used elsewhere in this app (e.g. `createProject` error
  handling).

## Testing (manual — this repo has no automated test suite)

1. Upload a file with one row whose name doesn't exist yet → row reports
   `"created"` → project appears in the Approvals page's Project
   Proposals card → Approve → project appears in the portfolio with the
   uploaded dates.
2. Upload a file with a row matching an existing approved project's name
   but different dates → row reports `"staged"` → project shows
   "Rebaseline Pending" badge in the portfolio table → appears in the
   Approvals page's Project Change card → Approve → project's dates
   update.
3. Re-upload the same file immediately after step 2's approval → row now
   reports `"skipped"` / `"No change"`.
4. Upload a row for a project that already has an unrelated pending
   rebaseline → reports `"skipped"` / `"Already has a pending change"`.
5. Upload a row with an unparseable date → reports `"error"` with a
   clear reason; other valid rows in the same file still process.
6. Upload a non-`.xlsx` file → single top-level error toast, no rows
   processed.
7. Confirm a Project Manager, a QA Lead, and a Head of QA can all see and
   use the Import Schedule button; confirm a QA Member cannot.
