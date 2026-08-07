-- QA Resource Manager — initial schema.
-- Run via Supabase Dashboard -> SQL Editor -> paste -> Run.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  name            text not null,
  email           text not null unique,
  role            text not null check (role in ('qa_lead','qa_member','project_manager')),
  qa_group        text check (qa_group in
                  ('qris_h2h','qris_bo','digital_h2h','digital_bo','corporate_it')),
  capacity_hours  numeric not null default 40 check (capacity_hours > 0),
  is_active       boolean not null default true,
  created_at      timestamptz not null default timezone('utc', now()),
  updated_at      timestamptz not null default timezone('utc', now())
);

create table if not exists public.projects (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  start_date        date not null,
  end_date          date,
  product           text not null check (product in
                    ('qris_h2h','qris_bo','qrcb','pi','jv','ccw')),
  status            text not null default 'to_do' check (status in
                    ('to_do','ready_sit','sit','ready_uat','uat','completed')),
  progress_percent  integer not null default 0 check (progress_percent between 0 and 100),
  approval_status   text not null default 'approved' check (approval_status in
                    ('pending','approved','rejected')),
  proposed_by       uuid references public.profiles(id),
  created_at        timestamptz not null default timezone('utc', now()),
  updated_at        timestamptz not null default timezone('utc', now())
);

create table if not exists public.allocations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  project_id       uuid not null references public.projects(id) on delete cascade,
  role_on_project  text not null,
  hours_per_week   numeric not null check (hours_per_week > 0),
  start_date       date not null,
  end_date         date,
  approval_status  text not null default 'approved' check (approval_status in
                   ('pending','approved','rejected')),
  proposed_by      uuid references public.profiles(id),
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);

create index if not exists allocations_user_idx on public.allocations (user_id);
create index if not exists allocations_project_idx on public.allocations (project_id);
create index if not exists allocations_date_range_idx on public.allocations (start_date, end_date);
create index if not exists projects_approval_status_idx on public.projects (approval_status);
create index if not exists allocations_approval_status_idx on public.allocations (approval_status);

-- updated_at auto-bump on every UPDATE, for all three tables.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

drop trigger if exists allocations_set_updated_at on public.allocations;
create trigger allocations_set_updated_at
  before update on public.allocations
  for each row execute function public.set_updated_at();

-- RLS — read-only for authenticated users. All writes go through the
-- service-role client in server actions (see src/lib/supabase/admin.ts);
-- there are deliberately no INSERT/UPDATE/DELETE policies.
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.allocations enable row level security;

create policy "Authenticated read" on public.profiles
  for select using (auth.role() = 'authenticated');
create policy "Authenticated read" on public.projects
  for select using (auth.role() = 'authenticated');
create policy "Authenticated read" on public.allocations
  for select using (auth.role() = 'authenticated');
