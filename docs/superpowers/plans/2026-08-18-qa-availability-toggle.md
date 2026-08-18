# QA Availability Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let QA Lead and Head of QA users mark a QA Member or QA Lead as "Unavailable" for new project assignments from Team Management — hidden from new-assignment pickers, unaffected everywhere existing/historical data is shown.

**Architecture:** A new `profiles.is_available` boolean column (default `true`), a new `setProfileAvailability` server action, a Team Management dropdown-menu action + badge, and an `availableOnly` filter threaded through `getAssignableProfiles()` applied only at the two actual assignment-creation pickers (Bulk Assign's Tester search, Allocation Tool's Select Resource list).

**Tech Stack:** Supabase (admin client for the write, regular client for reads), existing shadcn/ui `DropdownMenu`/`Badge` components — no new UI primitives needed.

## Global Constraints

- No automated test suite exists in this repo — verification is `npx tsc --noEmit` + `npx eslint` plus manual QA, per established project convention.
- Availability is separate from `is_active` — never conflate the two; both remain independently settable.
- Only two call sites of `getAssignableProfiles()` opt into `availableOnly: true` (Bulk Assign's Tester search). Every other caller (Dashboard's `QaMonthFilter`) keeps calling it with no arguments so it stays unaffected.
- Full design context: `docs/superpowers/specs/2026-08-18-qa-availability-toggle-design.md`.

---

### Task 1: Schema, type, and server actions

**Files:**
- Create: `supabase/migrations/0011_qa_availability.sql`
- Modify: `src/lib/profile.ts`
- Modify: `src/features/profile-action.ts`

**Interfaces:**
- Produces: `Profile.is_available: boolean`; `setProfileAvailability(id: string, isAvailable: boolean): Promise<{ success: true }>`; `getAssignableProfiles(opts?: { availableOnly?: boolean }): Promise<Profile[]>` (opts now optional, backward compatible with every existing no-argument call site).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0011_qa_availability.sql`:

```sql
-- Separate from is_active (account access): whether a QA Member/QA Lead
-- can currently be picked for new project assignments. Existing
-- assignments and account access are unaffected either way.
alter table profiles
  add column is_available boolean not null default true;
```

- [ ] **Step 2: Add the field to the Profile type**

In `src/lib/profile.ts`, add `is_available: boolean;` to the `Profile` type, next to `is_active`:

```ts
export type Profile = {
  id: string;
  name: string;
  email: string;
  role: ProfileRole;
  qa_group_id: string | null;
  capacity_days: number;
  is_active: boolean;
  is_available: boolean;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 3: Add `setProfileAvailability` and update `getAssignableProfiles`**

In `src/features/profile-action.ts`:

Change `getAssignableProfiles` from:
```ts
export async function getAssignableProfiles(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_active", true)
    .in("role", ["qa_lead", "qa_member"])
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}
```
to:
```ts
export async function getAssignableProfiles(opts: { availableOnly?: boolean } = {}): Promise<Profile[]> {
  const supabase = await createClient();
  let query = supabase
    .from("profiles")
    .select("*")
    .eq("is_active", true)
    .in("role", ["qa_lead", "qa_member"]);
  if (opts.availableOnly) query = query.eq("is_available", true);
  const { data, error } = await query.order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}
```

Add a new function, placed near `setProfileActive`:
```ts
export async function setProfileAvailability(id: string, isAvailable: boolean): Promise<{ success: true }> {
  await requireRole(QA_LEAD_ROLES);

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ is_available: isAvailable }).eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/lib/profile.ts src/features/profile-action.ts`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0011_qa_availability.sql src/lib/profile.ts src/features/profile-action.ts
git commit -m "feat: add QA availability field and setProfileAvailability action"
```

---

### Task 2: Team Management UI — badge and toggle action

**Files:**
- Modify: `src/components/team/team-table.tsx`

**Interfaces:**
- Consumes: `setProfileAvailability` from Task 1's `@/features/profile-action`.

- [ ] **Step 1: Import the action and an icon**

In `src/components/team/team-table.tsx`, update the lucide-react import to add `UserRoundX` and `UserRoundCheck` (distinct from the existing `UserX`/`UserCheck` used for Deactivate/Reactivate, so the two actions read differently at a glance):

```ts
import { KeyRound, MoreHorizontal, Pencil, UserCheck, UserRoundCheck, UserRoundX, UserX } from "lucide-react";
```

Add to the existing action import:
```ts
import { resetPassword, setProfileActive, setProfileAvailability } from "@/features/profile-action";
```

- [ ] **Step 2: Add the mutation**

Next to `toggleActiveMutation`, add:

```tsx
const toggleAvailableMutation = useMutation({
  mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) => setProfileAvailability(id, isAvailable),
  onSuccess: () => {
    toast.success("Team member updated");
    queryClient.invalidateQueries({ queryKey: ["profiles"] });
  },
  onError: (error: Error) => toast.error(error.message),
});
```

- [ ] **Step 3: Add the "Unavailable" badge next to the name**

Change the Name cell from:
```tsx
<TableCell className="pl-6 text-sm font-medium">{profile.name}</TableCell>
```
to:
```tsx
<TableCell className="pl-6 text-sm font-medium">
  {profile.name}
  {(profile.role === "qa_member" || profile.role === "qa_lead") && !profile.is_available && (
    <Badge variant="outline" className="ml-2 border-slate-300 bg-slate-100 text-slate-700">
      Unavailable
    </Badge>
  )}
</TableCell>
```

- [ ] **Step 4: Add the dropdown menu item**

In the row-actions `DropdownMenuContent`, right after the "Reset Password" `DropdownMenuItem` and before the Deactivate/Reactivate block, add:

```tsx
{(profile.role === "qa_member" || profile.role === "qa_lead") && (
  <DropdownMenuItem
    onSelect={() =>
      toggleAvailableMutation.mutate({ id: profile.id, isAvailable: !profile.is_available })
    }
  >
    {profile.is_available ? (
      <>
        <UserRoundX className="size-4" />
        Mark Unavailable
      </>
    ) : (
      <>
        <UserRoundCheck className="size-4" />
        Mark Available
      </>
    )}
  </DropdownMenuItem>
)}
```

This has no `viewerRole === "head_of_qa"` gate and no `profile.id !== viewerId` gate — unlike the Deactivate item, every `canWrite` viewer (QA Lead or Head of QA) can toggle any qa_member/qa_lead row's availability, including their own, per the design.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/components/team/team-table.tsx`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/team/team-table.tsx
git commit -m "feat: add availability badge and toggle to Team Management"
```

---

### Task 3: Filter the two assignment-creation pickers

**Files:**
- Modify: `src/components/allocations/bulk-assign-dialog.tsx`
- Modify: `src/components/allocations/allocations-page-content.tsx`

- [ ] **Step 1: Filter Bulk Assign's Tester search**

In `src/components/allocations/bulk-assign-dialog.tsx`, change:
```ts
queryFn: () => getAssignableProfiles(),
```
to:
```ts
queryFn: () => getAssignableProfiles({ availableOnly: true }),
```

(Leave the `queryKey` as `["assignable-profiles"]` — wait, check first: if `dashboard-page-content.tsx` also uses the queryKey `["assignable-profiles"]` for its own *unfiltered* call, giving both the same key would let TanStack Query serve one's cached (filtered) data to the other. Change this dialog's queryKey to `["assignable-profiles", "available"]` to keep the two caches distinct.)

```ts
const { data: testers } = useQuery({
  queryKey: ["assignable-profiles", "available"],
  queryFn: () => getAssignableProfiles({ availableOnly: true }),
});
```

- [ ] **Step 2: Filter the Allocation Tool's Select Resource list**

In `src/components/allocations/allocations-page-content.tsx`, change:
```ts
const resources = dashboard?.resourceLoad ?? [];
```
to:
```ts
const resources = (dashboard?.resourceLoad ?? []).filter((r) => r.profile.is_available);
```

This single change flows through to `filteredResources`, `groupedResources`, and the `selected` lookup, since all three derive from `resources`.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/components/allocations/bulk-assign-dialog.tsx src/components/allocations/allocations-page-content.tsx`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/allocations/bulk-assign-dialog.tsx src/components/allocations/allocations-page-content.tsx
git commit -m "feat: hide unavailable QAs from the Bulk Assign and Allocation Tool pickers"
```

---

### Task 4: Manual QA pass

**Files:** none (verification only)

- [ ] **Step 1: Apply the migration**

Apply `supabase/migrations/0011_qa_availability.sql` manually via the Supabase SQL editor (this project isn't CLI-linked here).

- [ ] **Step 2: Start the dev server and sign in as QA Lead or Head of QA**

Run: `npm run dev`, sign in, go to Team Management.

- [ ] **Step 3: Toggle a QA Member unavailable**

Open the row menu for a QA Member → "Mark Unavailable" → confirm the "Unavailable" badge appears next to their name and the menu item now reads "Mark Available".

- [ ] **Step 4: Confirm it's hidden from both pickers**

Go to the Allocation Tool → confirm that QA Member no longer appears in "Select Resource". Open "Assign QA" on an approved project (or the Allocation Tool's "Add Project" / Bulk Assign flow) → confirm they no longer appear in the Tester search.

- [ ] **Step 5: Confirm existing data is untouched**

If that QA Member already has assignments, confirm they still show normally in the Current Assignments table and in the project's Assigned QAs dialog.

- [ ] **Step 6: Confirm the Dashboard view filter is unaffected**

Go to the Dashboard → confirm that QA Member still appears in the QA filter dropdown, and their existing load still counts toward capacity figures.

- [ ] **Step 7: Toggle them back available**

Confirm they reappear in both pickers, and the badge disappears.

- [ ] **Step 8: Confirm role gating**

Confirm a QA Member login sees no toggle/badge-editing control anywhere (view-only). Confirm Head of QA and Project Manager rows never show the Unavailable badge or the toggle menu item, even when currently `is_available: false` in the database (shouldn't be reachable, but the UI should tolerate it gracefully regardless since the badge/menu-item conditions check role first).

- [ ] **Step 9: Confirm self-toggle works**

As a QA Lead, mark your own row unavailable and back — confirm no error (this action has no self-restriction, unlike Deactivate).

- [ ] **Step 10: Report results**

Note any failures back before considering this feature done — this task has no automated pass/fail, it's the actual acceptance check for the feature.
