# QA Availability Toggle — Design

## Summary

QA Lead and Head of QA users can mark an individual QA Member or QA Lead
as "Unavailable" for new project assignments, from Team Management.
Unavailable people are hidden from the pickers used to *create* new
assignments, but stay fully visible everywhere existing/historical data
is shown (Dashboard capacity, Current Assignments, Assigned QAs).

This is a separate, lighter-weight concept from the existing "Deactivate"
action — deactivating disables login/account access entirely; marking
someone unavailable only affects whether they can be picked for new work,
while everything else about their account (login, existing assignments,
dashboard visibility) is untouched.

## Data Model

New column, no other schema changes:

```sql
alter table profiles
  add column is_available boolean not null default true;
```

`Profile` type (`src/lib/profile.ts`) gains `is_available: boolean`.

## Who Can Toggle / Who Can Be Toggled

- **Actors:** QA Lead and Head of QA (`QA_LEAD_ROLES`) — same role gate
  already used for every other Team Management row action
  (`canWrite` in `team-page-content.tsx`).
- **Subjects:** rows with role `qa_member` or `qa_lead` — the two roles
  `getAssignableProfiles()` already treats as valid tester-assignment
  targets. Head of QA and Project Manager rows never show this control.
- No self-restriction: a QA Lead can mark their own row unavailable
  (e.g. going on leave). This differs deliberately from the existing
  self-deactivation block, which protects account access, not assignment
  eligibility.

## UI

**Team Management (`team-table.tsx` / new server action):**
- An "Unavailable" badge (reuse the existing outline-badge visual
  language, e.g. slate/gray to stay distinct from the violet "Lead"
  badge and the amber/emerald/rose approval-status badges) appears next
  to the name whenever `is_available === false`, for qa_member/qa_lead
  rows only.
- The row's existing actions `DropdownMenu` (Edit / Reset Password /
  Deactivate) gains one more item: "Mark Unavailable" (when currently
  available) or "Mark Available" (when currently unavailable) — only for
  qa_member/qa_lead rows, only when `canWrite`.

**New server action** `src/features/profile-action.ts`:
```ts
export async function setProfileAvailability(id: string, isAvailable: boolean): Promise<{ success: true }>;
```
- `requireRole(QA_LEAD_ROLES)`.
- No target-role restriction beyond what the UI already enforces (any
  qa_member/qa_lead id) — Head of QA rows never reach this action since
  the UI never renders the control for them, but the action itself
  doesn't need to re-validate the target's role since setting
  `is_available` on a Head of QA/PM row would just be an inert no-op if
  it somehow happened (that column is simply never read for those
  roles). Keeping the guard purely in the UI avoids duplicating role
  logic that has no behavioral consequence either way.
- Straight `admin.from("profiles").update({ is_available: isAvailable }).eq("id", id)`.

## Where Availability Is Enforced

**Filtered (new-assignment pickers):**
- `getAssignableProfiles()` (`src/features/profile-action.ts`) gains an
  optional parameter: `getAssignableProfiles({ availableOnly?: boolean })`.
  When `availableOnly: true`, adds `.eq("is_available", true)` to the
  existing active/role filter.
  - `bulk-assign-dialog.tsx`'s Tester search — used both from the
    Allocation Tool's "Add Project" flow and the Project Portfolio's
    "Assign QA" action (`presetProject`) — switches to
    `getAssignableProfiles({ availableOnly: true })`.
- Allocation Tool's own "Select Resource" list
  (`allocations-page-content.tsx`, built from
  `dashboard.resourceLoad[].profile`, which already carries the full
  `Profile` row including the new field via existing `select("*")`
  calls) — filters out `profile.is_available === false` client-side
  before rendering the resource list/search.

**Not filtered (view-only / historical, deliberately untouched):**
- `dashboard-page-content.tsx`'s `getAssignableProfiles()` call, which
  feeds `QaMonthFilter` — a *view* filter for "Ongoing Projects This
  Month," not an assignment picker. Keeps calling
  `getAssignableProfiles()` with no arguments (default `availableOnly:
  false`).
- Dashboard capacity/resourceLoad rendering itself (the Dashboard page,
  as opposed to the Allocation Tool page) — capacity/load figures still
  include unavailable people; only the Allocation Tool's *picker* is
  filtered.
- `assignments-table.tsx` (Current Assignments), `project-assignments-
  dialog.tsx` (Assigned QAs) — existing-allocation displays, never
  filtered by availability.
- `propose-project-dialog.tsx`'s auto-resolved QA Lead (via
  `getQaLeadCandidates()`) — explicitly unaffected per your answer;
  `getQaLeadCandidates()` is not modified.

## Testing (manual — this repo has no automated test suite)

1. As QA Lead/Head of QA, mark a QA Member unavailable on Team
   Management → "Unavailable" badge appears; "Mark Available" now shows
   in their row's menu.
2. Open the Allocation Tool → that person no longer appears in "Select
   Resource".
3. Open "Assign QA" on an approved project (or Bulk Assign on the
   Allocation Tool) → that person no longer appears in the Tester
   search.
4. Confirm their *existing* assignments still show normally in Current
   Assignments and in the project's Assigned QAs dialog.
5. Confirm the Dashboard's QA filter still lists them, and the
   Dashboard's own capacity view still includes their load.
6. Mark them available again → they reappear in both pickers.
7. Confirm a QA Member login sees no toggle control anywhere (not
   `canWrite`).
8. Confirm Head of QA and Project Manager rows never show the toggle.
