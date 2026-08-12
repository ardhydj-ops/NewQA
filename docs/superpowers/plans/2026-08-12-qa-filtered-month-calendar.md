# QA-Filtered Month Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, multi-select "Filter by QA" control above the Dashboard's "Ongoing Projects This Month" calendar, so it narrows to only projects with an approved allocation for one or more selected testers.

**Architecture:** One new server action returns a `project_id -> user_id[]` map of approved-allocation assignments for the selected month. A new controlled Popover+Command multi-select component (`QaMonthFilter`) collects the selected tester IDs. `DashboardPageContent` fetches both, filters the existing month-projects list client-side with a `useMemo`, and passes the filtered list to the existing `MonthCalendar`.

**Tech Stack:** Next.js App Router, React (client components), TanStack React Query v5, Supabase (`@supabase/ssr` server client), shadcn/ui (`Command`, `Popover`, `Button`), Tailwind CSS, TypeScript.

## Global Constraints

- Reuse the existing `getAssignableProfiles()` action (`src/features/profile-action.ts`) for the QA picker's options — do not add a new profiles query.
- The new action's month date-overlap logic must match `getProjectsForMonth`'s existing logic exactly (`.lte("start_date", month.end).or(\`end_date.is.null,end_date.gte.${month.start}\`)`), so "ongoing this month" means the same window in both places.
- Follow the existing Popover + `Command` combobox pattern already used in `src/components/allocations/allocation-form.tsx` for UI consistency (same imports, same `Check`/`ChevronsUpDown` icon usage, same `cn()` helper).
- `selectedQaIds` must persist across `year`/`monthIndex0` changes (do not reset the filter when the user pages to a different month).
- This repo has no automated test suite (confirmed: no test script in `package.json`, no `*.test.*`/`*.spec.*` files). Verification is `npx tsc --noEmit` plus manual exercising via the dev server — do not introduce a new test framework as part of this plan.
- New dashboard queries that read live allocation/project state must use `staleTime: 0`, matching the existing `weekly-dashboard` and `projects-for-month` queries in `dashboard-page-content.tsx` (fixed in a prior bug fix for the same staleness reason).

---

### Task 1: `getMonthAllocationAssignments` server action

**Files:**
- Modify: `src/features/dashboard-action.ts` (append after `getProjectsForMonth`, currently the last function in the file)

**Interfaces:**
- Consumes: `monthRange` (already imported in this file from `@/lib/load`), `createClient` (already imported from `@/lib/supabase/server`).
- Produces: `getMonthAllocationAssignments(year: number, monthIndex0: number): Promise<Record<string, string[]>>` — keys are `project_id`, values are distinct `user_id`s with an approved allocation overlapping that month. Consumed by Task 3.

- [ ] **Step 1: Add the function**

Append to the end of `src/features/dashboard-action.ts`:

```ts
/** project_id -> distinct user_ids with an approved allocation overlapping the month. */
export async function getMonthAllocationAssignments(
  year: number,
  monthIndex0: number,
): Promise<Record<string, string[]>> {
  const month = monthRange(year, monthIndex0);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("allocations")
    .select("project_id, user_id")
    .eq("approval_status", "approved")
    .lte("start_date", month.end)
    .or(`end_date.is.null,end_date.gte.${month.start}`);
  if (error) throw new Error(error.message);

  const map: Record<string, string[]> = {};
  for (const row of data ?? []) {
    const users = (map[row.project_id] ??= []);
    if (!users.includes(row.user_id)) users.push(row.user_id);
  }
  return map;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/dashboard-action.ts
git commit -m "feat: add getMonthAllocationAssignments for QA-filtered calendar"
```

---

### Task 2: `QaMonthFilter` component

**Files:**
- Create: `src/components/dashboard/qa-month-filter.tsx`

**Interfaces:**
- Consumes: `Profile` type from `@/lib/profile`; `Command`/`CommandInput`/`CommandList`/`CommandEmpty`/`CommandGroup`/`CommandItem` from `@/components/ui/command`; `Popover`/`PopoverContent`/`PopoverTrigger` from `@/components/ui/popover`; `Button` from `@/components/ui/button`; `cn` from `@/lib/utils`.
- Produces: `QaMonthFilter` component with props `{ profiles: Profile[]; selectedQaIds: string[]; onChange: (ids: string[]) => void }`. Purely controlled — no internal data fetching. Consumed by Task 3.

- [ ] **Step 1: Create the component**

Create `src/components/dashboard/qa-month-filter.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/profile";

type QaMonthFilterProps = {
  profiles: Profile[];
  selectedQaIds: string[];
  onChange: (ids: string[]) => void;
};

export function QaMonthFilter({ profiles, selectedQaIds, onChange }: QaMonthFilterProps) {
  const [open, setOpen] = useState(false);

  function toggle(id: string) {
    onChange(
      selectedQaIds.includes(id)
        ? selectedQaIds.filter((existingId) => existingId !== id)
        : [...selectedQaIds, id],
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-56 justify-between font-normal"
        >
          <span className={cn("truncate", selectedQaIds.length === 0 && "text-muted-foreground")}>
            {selectedQaIds.length === 0
              ? "Filter by QA"
              : `${selectedQaIds.length} QA${selectedQaIds.length === 1 ? "" : "s"} selected`}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Search testers..." />
          <CommandList>
            <CommandEmpty>No testers found.</CommandEmpty>
            <CommandGroup>
              {profiles.map((profile) => (
                <CommandItem key={profile.id} value={profile.name} onSelect={() => toggle(profile.id)}>
                  <Check
                    className={cn("size-4", selectedQaIds.includes(profile.id) ? "opacity-100" : "opacity-0")}
                  />
                  {profile.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

Note this deliberately does not close the popover on `onSelect` (unlike the single-select project combobox in `allocation-form.tsx`) — a multi-select stays open so the user can check several testers in a row.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/qa-month-filter.tsx
git commit -m "feat: add QaMonthFilter multi-select component"
```

---

### Task 3: Wire the filter into the Dashboard

**Files:**
- Modify: `src/components/dashboard/dashboard-page-content.tsx`

**Interfaces:**
- Consumes: `getMonthAllocationAssignments` (Task 1), `QaMonthFilter` (Task 2), `getAssignableProfiles` from `@/features/profile-action` (existing action, already used by `bulk-assign-dialog.tsx` under the same `["assignable-profiles"]` query key).
- Produces: the wired-up Dashboard page — no further tasks depend on this.

- [ ] **Step 1: Add imports**

In `src/components/dashboard/dashboard-page-content.tsx`, add `useMemo` to the existing React import, add `Button`, add `QaMonthFilter`, add `getAssignableProfiles`, and add `getMonthAllocationAssignments` to the existing dashboard-action import:

```tsx
import { useMemo, useState } from "react";
```

```tsx
import { Button } from "@/components/ui/button";
```

```tsx
import { QaMonthFilter } from "@/components/dashboard/qa-month-filter";
```

```tsx
import {
  getMonthAllocationAssignments,
  getProjectsForMonth,
  getWeeklyDashboard,
} from "@/features/dashboard-action";
import { getAssignableProfiles } from "@/features/profile-action";
```

- [ ] **Step 2: Add filter state**

Add alongside the existing `useState` calls in `DashboardPageContent`:

```tsx
const [selectedQaIds, setSelectedQaIds] = useState<string[]>([]);
```

- [ ] **Step 3: Add the two new queries**

Add after the existing `monthProjects` query:

```tsx
const { data: monthAssignments } = useQuery({
  queryKey: ["month-allocation-assignments", year, monthIndex0],
  queryFn: () => getMonthAllocationAssignments(year, monthIndex0),
  staleTime: 0,
});

const { data: assignableProfiles } = useQuery({
  queryKey: ["assignable-profiles"],
  queryFn: () => getAssignableProfiles(),
});
```

- [ ] **Step 4: Compute the filtered project list**

Add after the `monthValue` computation:

```tsx
const visibleMonthProjects = useMemo(() => {
  if (selectedQaIds.length === 0) return monthProjects ?? [];
  return (monthProjects ?? []).filter((p) =>
    (monthAssignments?.[p.id] ?? []).some((userId) => selectedQaIds.includes(userId)),
  );
}, [monthProjects, monthAssignments, selectedQaIds]);
```

- [ ] **Step 5: Add the filter control next to the Month picker**

Replace the existing Month picker block:

```tsx
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
```

with:

```tsx
      <div className="flex flex-wrap items-end gap-3">
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
        <QaMonthFilter
          profiles={assignableProfiles ?? []}
          selectedQaIds={selectedQaIds}
          onChange={setSelectedQaIds}
        />
        {selectedQaIds.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setSelectedQaIds([])}>
            Clear
          </Button>
        )}
      </div>
```

- [ ] **Step 6: Filter the calendar and add the empty state**

Replace the calendar card body:

```tsx
      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-4 text-lg font-semibold">Ongoing Projects This Month</h2>
          {monthLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <MonthCalendar year={year} monthIndex0={monthIndex0} projects={monthProjects ?? []} />
          )}
        </CardContent>
      </Card>
```

with:

```tsx
      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-4 text-lg font-semibold">Ongoing Projects This Month</h2>
          {monthLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : visibleMonthProjects.length === 0 && selectedQaIds.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              No ongoing projects for the selected QA(s) this month.
            </p>
          ) : (
            <MonthCalendar year={year} monthIndex0={monthIndex0} projects={visibleMonthProjects} />
          )}
        </CardContent>
      </Card>
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Manual verification**

Run the dev server (`npm run dev`), sign in, and on `/dashboard`:

1. Confirm "Filter by QA" appears next to the Month picker, and the calendar shows the same projects as before (unfiltered baseline).
2. Open the filter, select one tester who has an assignment this month — confirm the calendar narrows to only their project(s), and the button label changes to "1 QA selected".
3. Select a second tester — confirm their project(s) are added to the visible set (union, not intersection).
4. Select a tester with no assignments this month (alone) — confirm the calendar shows "No ongoing projects for the selected QA(s) this month."
5. Click "Clear" — confirm the calendar returns to the full unfiltered list and the button resets to "Filter by QA".
6. With a filter active, change the Month picker to a different month — confirm the filter selection is preserved (button still shows the same "N QAs selected") and the calendar re-filters for the new month.

- [ ] **Step 9: Commit**

```bash
git add src/components/dashboard/dashboard-page-content.tsx
git commit -m "feat: wire QA filter into Ongoing Projects This Month calendar"
```
