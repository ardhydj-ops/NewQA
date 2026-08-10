-- QA Resource Manager v2 — capacity governance, richer allocation control,
-- new work-item types, password reset support.
-- Run via Supabase Dashboard -> SQL Editor -> paste -> Run.

create table if not exists public.app_settings (
  id                     boolean primary key default true,
  max_parallel_projects  integer not null default 3 check (max_parallel_projects > 0),
  updated_at             timestamptz not null default timezone('utc', now()),
  constraint app_settings_singleton check (id)
);

insert into public.app_settings (id)
values (true)
on conflict (id) do nothing;

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;

create policy "Authenticated read" on public.app_settings
  for select using (auth.role() = 'authenticated');

alter table public.projects
  add column if not exists item_type text not null default 'project' check (item_type in
    ('project','support_testing','problem_incident','service_request')),
  add column if not exists total_working_hours numeric not null default 0 check (total_working_hours >= 0),
  add column if not exists priority text not null default 'medium' check (priority in
    ('low','medium','high','critical'));

alter table public.allocations
  add column if not exists priority text not null default 'medium' check (priority in
    ('low','medium','high','critical')),
  add column if not exists proposed_start_date date,
  add column if not exists proposed_end_date date,
  add column if not exists proposed_hours_per_week numeric check
    (proposed_hours_per_week is null or proposed_hours_per_week > 0),
  add column if not exists proposed_priority text check
    (proposed_priority is null or proposed_priority in ('low','medium','high','critical')),
  add column if not exists change_proposed_by uuid references public.profiles(id),
  add column if not exists change_requested_at timestamptz;

create index if not exists projects_item_type_idx on public.projects (item_type);
create index if not exists allocations_change_proposed_by_idx
  on public.allocations (change_proposed_by) where change_proposed_by is not null;
