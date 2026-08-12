# QA Group / Product / Lead Mappings — Design

## Context

Today `qa_groups` and `products` are both flat name lists with no relationship
to each other or to people, managed via a shared `NameEntityCard` on
Settings. This adds two explicit, one-owner mappings — configured on
Settings — and uses them in three places: highlighting each group's lead on
the Dashboard and Allocation Tool, and defaulting a QA Lead's Project
Portfolio view to their own group's projects.

Both mappings are "one owner": a product belongs to exactly one QA Group,
and a QA Group has exactly one designated QA Lead (that same person may
lead more than one group). Neither relationship needs a join table — both
get a simple nullable FK column, mirroring the existing
`profiles.qa_group_id` pattern already in this codebase.

## 1. Data model

New migration `0009_qa_group_product_leads.sql`:

```sql
alter table public.qa_groups add column lead_user_id uuid references public.profiles(id);
alter table public.products add column qa_group_id uuid references public.qa_groups(id);

create index qa_groups_lead_user_id_idx on public.qa_groups (lead_user_id);
create index products_qa_group_id_idx on public.products (qa_group_id);
```

No `on delete` clause on either — same as the existing
`profiles.qa_group_id references public.qa_groups(id)` column, which relies
on the application layer to block deletes rather than a DB-level cascade
(profiles are never hard-deleted, only deactivated, so `lead_user_id` never
needs to handle a disappearing row).

## 2. Types & schemas

- `src/lib/qa-group.ts`: `QaGroupRow` gains `lead_user_id: string | null`.
- `src/lib/product.ts`: `ProductRow` gains `qa_group_id: string | null`.
- `src/features/qa-group-schema.ts`: `QaGroupInput` gains
  `lead_user_id: z.string().uuid().nullable()`.
- `src/features/product-schema.ts`: `ProductInput` gains
  `qa_group_id: z.string().uuid().nullable()`.

## 3. Server actions

**`src/features/qa-group-action.ts`**
- `getQaGroups()`: select `id, name, lead_user_id` instead of `id, name`.
- `createQaGroup`/`updateQaGroup`: pass `lead_user_id: parsed.data.lead_user_id`
  through to the insert/update.
- `deleteQaGroup`: add a second guard alongside the existing "QAs still in
  this group" check — block if any `products.qa_group_id` still references
  it, with the same message pattern: `"Can't delete: N product(s) still
  assigned to this group."`

**`src/features/product-action.ts`**
- `getProducts()`: select `id, name, qa_group_id` instead of `id, name`.
- `createProduct`/`updateProduct`: pass `qa_group_id: parsed.data.qa_group_id`
  through.

**`src/features/profile-action.ts`**
- New `getQaLeadCandidates(): Promise<Profile[]>` — active profiles with
  `role in ('qa_lead', 'head_of_qa')`, sorted by name. Powers the "Lead"
  picker on the QA Groups settings card (distinct from the existing
  `getAssignableProfiles()`, which returns `qa_lead`/`qa_member` for
  assignment pickers — different role set, different purpose).

**`src/features/project-action.ts`**
- `getProjects(...)` gains an optional `qa_group_id` param. Resolved the
  same way the existing `product_id` filter already is (fetch matching
  `project_id`s, then `.in("id", ...)`), just one hop further: `qa_group_id`
  → matching `products.id`s → matching `project_products.project_id`s. If
  both `product_id` and `qa_group_id` filters are supplied at once, intersect
  the two resulting project-id sets rather than picking one:

  ```ts
  if (qa_group_id) {
    const { data: groupProducts, error: gpError } = await supabase
      .from("products")
      .select("id")
      .eq("qa_group_id", qa_group_id);
    if (gpError) throw new Error(gpError.message);
    const productIds = (groupProducts ?? []).map((p) => p.id);
    if (productIds.length === 0) return [];

    const { data: matches, error: matchError } = await supabase
      .from("project_products")
      .select("project_id")
      .in("product_id", productIds);
    if (matchError) throw new Error(matchError.message);
    const groupProjectIds = new Set((matches ?? []).map((m) => m.project_id));

    projectIdFilter = projectIdFilter
      ? projectIdFilter.filter((id) => groupProjectIds.has(id))
      : [...groupProjectIds];
    if (projectIdFilter.length === 0) return [];
  }
  ```

  (`projectIdFilter` here generalizes the existing `product_id` branch's
  local variable so the two filters compose instead of one silently
  overwriting the other.)

## 4. Settings UI

Two new bespoke cards replace both `NameEntityCard` usages (which becomes
dead code afterward — delete `src/components/settings/name-entity-card.tsx`):

- `src/components/settings/qa-group-card.tsx`: same table/add/edit/delete
  shell as today, plus a "Lead" column and a `<Select>` in the add/edit
  dialog scoped to `getQaLeadCandidates()`, with a "No lead assigned" option
  (maps to `null`).
- `src/components/settings/product-card.tsx`: same shell, plus a "QA Group"
  column and a `<Select>` scoped to `getQaGroups()`, with a "No group
  assigned" option.

## 5. Dashboard & Allocation Tool — highlight the group's lead

Both pages already group QA members by `qa_group_id` and already fetch
`getQaGroups()` (`dashboard-page-content.tsx`'s `groupSections`,
`allocations-page-content.tsx`'s `groupedResources`). Since `QaGroupRow` now
carries `lead_user_id`, each page's existing per-group member array gets:

```ts
const isLead = (memberId: string) => memberId === group.lead_user_id;
const sortedMembers = [...group.members].sort((a, b) =>
  Number(isLead(b.profile.id)) - Number(isLead(a.profile.id)),
);
```

(a stable sort that only ever moves the lead to the front, leaving
everyone else's relative order untouched.) The lead's row renders a small
"Lead" badge next to their name and a subtle highlight (`bg-violet-50`
background, `border-violet-200` badge) — violet is not already used for any
status meaning in this app (amber=pending, emerald=approved, rose=rejected,
blue=pending change), so "Lead" reads as its own distinct signal rather than
colliding with status semantics. The "Unassigned" bucket (members with no
`qa_group_id`) is untouched — no group, no lead concept applies there.

## 6. Project Portfolio — QA Group filter with a QA Lead default

- `src/app/(app)/projects/page.tsx`: pass `qaGroupId={profile!.qa_group_id}`
  to `ProjectsPageContent` (the full profile is already fetched here).
- `src/components/projects/projects-page-content.tsx`:
  - New query: `getQaGroups()` (for the filter dropdown's options).
  - New filter state: `qaGroupFilter`, initialized via
    `useState(() => (role === "qa_lead" ? (qaGroupId ?? "") : ""))` — a
    `qa_lead` with a group assigned starts filtered to it; every other role
    (including `head_of_qa`, per your answer) starts unfiltered, same as
    today.
  - New `<Select>` in the filter bar, "QA Group" / "All QA Groups", next to
    the existing Product filter — manually changeable/clearable like any
    other filter.
  - `getProjects({ ..., qa_group_id: qaGroupFilter })` passes the new param
    through.

## 7. Edge cases

- **Product with no group / group with no lead**: both FKs are nullable:
  "No group assigned" / "No lead assigned" render as the picker's empty
  state; nothing to highlight, no default filter applied.
- **A `qa_lead` whose own `qa_group_id` is null**: Project Portfolio's
  filter simply starts as "All QA Groups" (unfiltered) — same as today's
  behavior, no special-casing needed.
- **Deleting a QA Group that's still a product's owner**: blocked, per §3.
- **Deleting/deactivating the profile set as a group's lead**: profiles are
  never hard-deleted in this app, so `lead_user_id` never dangles. A
  deactivated lead still renders as "Lead" if still referenced — acceptable,
  matches how the rest of the app doesn't retroactively scrub deactivated
  users out of historical/derived views.

## 8. Testing

No automated test suite exists in this repo. Verification is manual: assign
a QA Group's lead and a product's group in Settings, confirm the guard
blocks deleting a group that still owns a product, confirm the lead is
pinned + badged on both the Dashboard and Allocation Tool group sections,
and confirm a `qa_lead` account's Project Portfolio opens pre-filtered to
their group while `head_of_qa`'s doesn't — plus `npx tsc --noEmit` staying
clean throughout.
