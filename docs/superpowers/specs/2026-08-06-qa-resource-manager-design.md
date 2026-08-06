# QA Resource Manager — Design

## Context

This repository previously held "Fina App", a personal finance tracker. That project's
files have been intentionally cleared to start fresh. This spec covers a new,
unrelated application: **QA Resource Manager**, an internal tool for a QA team lead to
track team capacity, project allocation, and workload distribution — specifically to
spot overwork or idle time before they become a problem.

A UI reference (Google Stitch export) exists at
`stitch_qa_resource_manager/` with a design-system doc
(`kinetic_enterprise/DESIGN.md`) and screen mockups for four pages: Resource Dashboard,
Team Management, Project Portfolio, Allocation Tool. This spec follows that structure
and visual system, adapted to the data model and scope decided below (the mockups use
placeholder data/fields that don't all carry over — deviations are called out inline).

## Roles & auth

Two roles, stored on the user's own profile row (one field serves as both job label and
permission level):

- **QA Lead** — full CRUD on Users, Projects, Allocations; sees all dashboard/report data.
- **QA Member** — read-only everywhere; sees the same team-wide dashboard/report data as
  QA Lead, just without create/edit/delete controls.

Auth uses Supabase Auth (email/password) for identity. Authorization (what a given role
can do) is enforced in server actions by checking the caller's `profiles.role` — not via
complex per-table RLS logic, consistent with this codebase's existing permissive-RLS
pattern. Creating a user via Team Management calls the Supabase Admin API to provision
their login directly with a temporary password shown once on screen — no SMTP/email
delivery dependency.

## Data model

Three tables, `supabase/migrations/0001_qa_resource_manager.sql`:

```sql
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  name            text not null,
  email           text not null unique,
  role            text not null check (role in ('qa_lead','qa_member')),
  capacity_hours  numeric not null default 40 check (capacity_hours > 0),
  is_active       boolean not null default true,
  created_at      timestamptz not null default timezone('utc', now()),
  updated_at      timestamptz not null default timezone('utc', now())
);

create table public.projects (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  start_date        date not null,
  end_date          date,
  product           text not null check (product in
                    ('qris_h2h','qris_bo','qrcb','pi','jv','ccw')),
  status            text not null default 'to_do' check (status in
                    ('to_do','ready_sit','sit','ready_uat','uat','completed')),
  progress_percent  integer not null default 0 check (progress_percent between 0 and 100),
  created_at        timestamptz not null default timezone('utc', now()),
  updated_at        timestamptz not null default timezone('utc', now())
);

create table public.allocations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  project_id       uuid not null references public.projects(id) on delete cascade,
  role_on_project  text not null,
  hours_per_week   numeric not null check (hours_per_week > 0),
  start_date       date not null,
  end_date         date,
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);

create index allocations_user_idx on public.allocations (user_id);
create index allocations_project_idx on public.allocations (project_id);
create index allocations_date_range_idx on public.allocations (start_date, end_date);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.allocations enable row level security;

create policy "Authenticated read" on public.profiles for select using (auth.role() = 'authenticated');
create policy "Authenticated read" on public.projects for select using (auth.role() = 'authenticated');
create policy "Authenticated read" on public.allocations for select using (auth.role() = 'authenticated');
-- writes go through server actions using the service role; no client-side write policies
```

Notes:
- `profiles.id` mirrors `auth.users.id` (created together when a QA Lead adds a user).
- Deleting a user is a **soft delete** (`is_active = false`), not a row delete — keeps
  historical allocations valid and out of active pickers/dashboards.
- No hard cap enforced anywhere on `hours_per_week` vs `capacity_hours` — overallocation
  is always allowed and only surfaced visually (color-coded load %).
- `end_date` nullable on both `projects` and `allocations` means "ongoing"/open-ended.
- Load and demand figures are never stored — always computed on read (see Calculations).

## Visual design system

Implemented via Tailwind theme + shadcn/ui, using the tokens and component specs in
`stitch_qa_resource_manager/kinetic_enterprise/DESIGN.md`:
- Deep-navy fixed 240px sidebar; Professional Blue for actions/active states/links.
- Semantic status colors: green (load <80%), amber (80–100%), red (>100%).
- Inter typeface; 4px/8px border radii; low-shadow "tonal layer" elevation (no heavy
  drop shadows); data tables with slate header, 48px rows, right-aligned numerics.
- Status badges, progress bars (pill-shaped, dynamic semantic color), modal forms
  (560px max-width, right-aligned footer actions) per that doc's Components section.

## Pages & architecture

Nav (login-gated, all four items visible to both roles; write controls hidden for
QA Member): **Resource Dashboard, Team Management, Project Portfolio, Allocation Tool**.

**Resource Dashboard** (`src/app/dashboard/page.tsx`) — the single home for both the
"Resource Load Dashboard" and "Workload Distribution Report" requirements:
- Summary cards: Total QA Capacity, Total Allocated, Available Capacity — all in
  hrs/week, computed for the selected week (defaults to current week, week picker).
- Resource Load table: one row per active QA member, Alloc/Cap (hrs), Load % with
  color-coded bar, for the selected week.
- Top Product Demand panel: projects ranked by total allocated hours in the selected
  week (deviation from mockup: no separate "requested hours" target field — out of
  confirmed scope — ranking is purely by allocated hours).
- Monthly section: month picker (defaults to current month); per-QA-member total
  allocated hours that month, and per-project total demand that month, each as a
  ranked list/bar (satisfies the "workload distribution" requirement on this same page).

**Team Management** (`src/app/team/page.tsx`) — table (Name, Email, Role, Capacity,
Actions) + create/edit dialog. Create calls a server action that provisions the
Supabase Auth user (Admin API, temp password) and inserts the `profiles` row in one
step; the temp password is shown once in the dialog on success. Delete sets
`is_active = false`. QA Lead only for writes; QA Member sees the table read-only.

**Project Portfolio** (`src/app/projects/page.tsx`) — table (Project Name, Product,
Start/End Date, Status badge, Progress % bar, Actions) with Status/Product filter
dropdowns and name search; create/edit dialog. QA Lead only for writes.

**Allocation Tool** (`src/app/allocations/page.tsx`) — two-panel layout:
- Left: searchable list of active QA members, each showing a mini Alloc/Cap bar for
  the current week.
- Right: form for the selected member — Target Project (dropdown), Role on Project
  (text), Allocated Hours (weekly), Duration (start/end date), Clear/Assign actions.
- Below: "Current Assignments" table for the selected member (Project, Role, Hours/Wk,
  Timeline, edit/delete), with a Total Allocated footer.
QA Lead only for writes; QA Member sees the assignments table read-only (no left-panel
picker/form).

**Shared**: `src/lib/profile.ts`, `src/lib/project.ts`, `src/lib/allocation.ts` (types),
`src/features/*-schema.ts` (Zod), `src/features/*-action.ts` (server actions, role-gated),
`src/lib/load.ts` (pure calculation helpers, see below).

## Calculations

All computed on read in `src/lib/load.ts`, no stored aggregates. Weeks are ISO weeks
(Monday–Sunday).

- **Weekly load %** (per user, per week `W`): sum `hours_per_week` for allocations where
  `start_date <= W.end and (end_date is null or end_date >= W.start)`, divide by
  `capacity_hours`, × 100. 0% if the user has no active allocations that week.
- **Monthly per-member hours** (per user, per month `M`): for each allocation
  overlapping `M`, prorate by daily rate rather than counting whole weeks (avoids
  ambiguity at month boundaries): `(hours_per_week / 7) × overlap_days`, where
  `overlap_days` is the number of days the allocation's `[start_date, end_date]` range
  (open-ended treated as extending through the end of `M`) intersects `M`. Summed per
  user, rounded to the nearest whole hour for display.
- **Monthly/weekly per-project demand**: same overlap and proration logic, summed by
  `project_id` instead of `user_id`, sorted descending.

## Out of scope for v1

Email invites/SMTP, hard allocation caps, historical audit trail, multi-team/company
support, "requested hours" target per project, QA Group field on users.
