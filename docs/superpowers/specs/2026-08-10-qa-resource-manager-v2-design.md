# QA Resource Manager v2 — Design

## Context

This extends the v1 app (`docs/superpowers/specs/2026-08-06-qa-resource-manager-design.md`,
already built and merged) with capacity governance, richer allocation control, more
work-item types, and two admin conveniences. No new roles — QA Lead / QA Member /
Project Manager stay as-is; "admin" in the request maps to QA Lead throughout.

## 1. Global settings

New singleton table, one setting for now:

```sql
create table public.app_settings (
  id                     boolean primary key default true,
  max_parallel_projects  integer not null default 3 check (max_parallel_projects > 0),
  updated_at             timestamptz not null default timezone('utc', now()),
  constraint app_settings_singleton check (id)
);
insert into public.app_settings (id) values (true);

alter table public.app_settings enable row level security;
create policy "Authenticated read" on public.app_settings
  for select using (auth.role() = 'authenticated');
```

New `/settings` page and sidebar item, QA Lead only (same route-guard pattern as
`/approvals`): one number input (Max Parallel Projects) + Save. Home for future global
settings too.

## 2. Data model: projects become general "work items"

No new table — `product`, `status`, and their shared lifecycle already fit all four
kinds of work per the confirmed scope. `projects` gains:

```sql
alter table public.projects
  add column item_type text not null default 'project' check (item_type in
    ('project','support_testing','problem_incident','service_request')),
  add column total_working_hours numeric not null default 0 check (total_working_hours >= 0),
  add column priority text not null default 'medium' check (priority in
    ('low','medium','high','critical'));
```

`end_date` stays nullable at the DB level (existing rows have none) — **mandatory is
enforced in the Zod schema / form for every new create or edit going forward**, not by
a DB constraint. Same soft-migration approach for `total_working_hours` and `priority`:
DB defaults keep old rows valid; the form requires real values from here on.

`item_type` drives the Project Portfolio table's Type badge and the create dialog's
Item Type selector; `product`, `status`, and their existing check-constraint lists are
unchanged and apply uniformly across all four types.

## 3. Data model: allocation priority + pending-change staging

```sql
alter table public.allocations
  add column priority text not null default 'medium' check (priority in
    ('low','medium','high','critical')),
  add column proposed_start_date date,
  add column proposed_end_date date,
  add column proposed_hours_per_week numeric check
    (proposed_hours_per_week is null or proposed_hours_per_week > 0),
  add column proposed_priority text check
    (proposed_priority is null or proposed_priority in ('low','medium','high','critical')),
  add column change_proposed_by uuid references public.profiles(id),
  add column change_requested_at timestamptz;
```

`allocations.priority` is independent of `projects.priority` — it's this QA's personal
ranking of this specific assignment among their other concurrent work, not the item's
own general importance.

The `proposed_*` columns are a full snapshot of a requested change (start, end, hours,
priority — always written together, never partially) to an **already-approved**
allocation. `change_proposed_by`/`change_requested_at` identify and order pending
requests for the Approvals page. Only a Project Manager's rebaseline request uses this
path — a QA Lead's own edit (via the existing edit dialog, now also covering priority)
writes directly to the live columns and never touches `proposed_*`. A row with
non-null `proposed_start_date` has exactly one pending change; a new request cannot be
submitted while one is already pending (submit is rejected with an error until the
existing one is approved/rejected).

Approving a change: copy all `proposed_*` values onto the live columns, clear
`proposed_*`, `change_proposed_by`, `change_requested_at`. Rejecting: just clear those
same fields, live columns untouched. Both re-run the parallel-limit check (Section 4)
against the *proposed* date range before applying — a rebaseline that would push the QA
over their limit is rejected the same as a fresh over-limit assignment.

## 4. Max-parallel-projects enforcement

A shared guard, given a QA and a candidate date range: count **distinct `project_id`s**
among that QA's *approved* allocations whose range overlaps it (same overlap test as
`load.ts`'s week/month math), across all four `item_type`s. If adding/approving/
rebaselining would make that count exceed `app_settings.max_parallel_projects`, the
action is rejected outright (hard block, unlike the load-% overallocation warning,
which stays visual-only per v1).

Checked at every point an allocation becomes or stays approved with a given range:
direct QA-Lead creation (single or bulk), approving a pending proposal (single or
project-proposal bundle), and approving a staged rebaseline change.

## 5. Allocation Tool: three ways to assign/adjust

**A. Existing single-QA form** (unchanged flow) gains a Priority field.

**B. New bulk "Add Project" action**: pick one approved work item (its
`total_working_hours`, `start_date`, `end_date` come from Project Portfolio) → multi-
select several QAs → one shared Role-on-Project text → preview shows each QA's computed
`hours_per_week = total_working_hours ÷ number_of_QAs ÷ weeks_between(start_date,
end_date)` before submit, where `weeks_between = max(1, (end_date − start_date in days
+ 1) ÷ 7)` (inclusive day count, same convention as `load.ts`'s overlap math; not
rounded — `hours_per_week` is numeric and may come out fractional). On submit, creates
one allocation per selected QA (each still an independent row). QA-Lead-run batches go live immediately, one at a time, subject to
the parallel-limit check per QA — if some QAs pass and others don't, the ones that pass
are created and the failures are reported by name, rather than the whole batch aborting.
PM-run batches are standalone `pending` proposals, same rule as today's single-QA PM
flow.

**C. Rebaseline**: on an existing *approved* allocation, both roles get a "Rebaseline"
action (start date, end date, hours/week, priority — same four fields as `proposed_*`).
QA Lead's applies immediately via the existing update path. PM's calls the new
staged-change path (Section 3) and the row shows a "Pending Change" badge until
resolved. A row already carrying a pending change can't be rebaselined again until that
one clears.

Approvals page gains a third section, "Pending Allocation Changes": current vs.
proposed values side by side, Approve/Reject per row.

## 6. Project Portfolio UI

Single creation dialog (QA Lead: direct-approved; PM: proposal) gains an Item Type
selector (Project / Support Testing / Problem Incident / Service Request, default
Project) — replaces the "New Project"/"Propose Project" framing with a more general
"New Item"/"Propose Item", since the form and mechanics are now identical across types.
Also gains required Total Working Hours (positive number) and Priority fields;
End Date changes from optional to required.

Table gains a Type badge and Priority badge next to the existing Product/Status badges,
plus a Total Hours column.

## 7. Team Management: password reset

New "Reset Password" row action, QA Lead only, on active users. Calls the Supabase
Admin API to set a new random password (same generator already used for account
creation) and shows it once in a dialog — no email/SMTP, consistent with v1.

## 8. Dashboard: utilization bars

"Total Allocated" card gains a `LoadBar` (existing component) showing
`totalAllocated / totalCapacity`. New "Avg Available Capacity" card/stat showing the
average, across all active QA members in `resourceLoad`, of `100 − loadPercent`.

## 9. Auto-complete cascade

When a QA Lead changes a work item's status to `completed` (PMs still can't edit
approved items at all — no change there), the same `updateProject` call, in sequence:

1. Sets `progress_percent` to 100 if not already.
2. For each *approved* allocation on that item: if it already started
   (`start_date <= today`), sets `end_date` to today (only if currently null or later
   than today — never pulls an earlier end_date forward); if it hadn't started yet
   (`start_date > today`), deletes the row outright.
3. For each *pending* allocation proposal on that item (standalone or part of a
   project-proposal bundle that somehow wasn't resolved), sets `approval_status` to
   `rejected`.
4. For each allocation on that item carrying a pending rebaseline change
   (`proposed_start_date is not null`), clears the `proposed_*`/`change_proposed_by`/
   `change_requested_at` fields (equivalent to rejecting the change) — in addition to
   step 2's close-out of the row's live dates.

This is the only place status changes trigger side effects on allocations; setting
status to any other value never touches them.

## Out of scope for v2

Per-QA custom parallel limits (global only), a full audit trail of rebaseline history,
email/notification on approval decisions, editing `item_type`/`product`/`status` value
lists themselves from the Settings page (still hardcoded enums).
