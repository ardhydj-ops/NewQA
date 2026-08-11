-- Project rebaseline: a PM proposes schedule/priority changes to an
-- approved project; the change is staged until a QA Lead approves or
-- rejects it. Mirrors allocations.proposed_* from migration 0002.

alter table public.projects
  add column if not exists proposed_start_date date,
  add column if not exists proposed_end_date date,
  add column if not exists proposed_total_working_days numeric,
  add column if not exists proposed_priority text check
    (proposed_priority is null or proposed_priority in ('low','medium','high','critical')),
  add column if not exists change_proposed_by uuid references public.profiles(id),
  add column if not exists change_requested_at timestamptz;

alter table public.projects drop constraint if exists projects_proposed_total_working_days_check;
alter table public.projects add constraint projects_proposed_total_working_days_check
  check (proposed_total_working_days is null or
    (proposed_total_working_days > 0 and proposed_total_working_days = round(proposed_total_working_days * 2) / 2));

create index if not exists projects_change_proposed_by_idx
  on public.projects (change_proposed_by) where change_proposed_by is not null;
