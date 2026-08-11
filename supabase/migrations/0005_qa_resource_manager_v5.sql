alter table public.profiles rename column capacity_hours to capacity_days;
update public.profiles set capacity_days = round(capacity_days / 8 * 2) / 2;
alter table public.profiles alter column capacity_days set default 5;
alter table public.profiles drop constraint if exists profiles_capacity_hours_check;
alter table public.profiles add constraint profiles_capacity_days_check
  check (capacity_days > 0 and capacity_days = round(capacity_days * 2) / 2);

alter table public.allocations rename column hours_per_week to days_per_week;
update public.allocations set days_per_week = round(days_per_week / 8 * 2) / 2;
alter table public.allocations drop constraint if exists allocations_hours_per_week_check;
alter table public.allocations add constraint allocations_days_per_week_check
  check (days_per_week > 0 and days_per_week = round(days_per_week * 2) / 2);

alter table public.allocations rename column proposed_hours_per_week to proposed_days_per_week;
update public.allocations set proposed_days_per_week = round(proposed_days_per_week / 8 * 2) / 2
  where proposed_days_per_week is not null;
alter table public.allocations drop constraint if exists allocations_proposed_hours_per_week_check;
alter table public.allocations add constraint allocations_proposed_days_per_week_check
  check (proposed_days_per_week is null or
    (proposed_days_per_week > 0 and proposed_days_per_week = round(proposed_days_per_week * 2) / 2));

alter table public.projects rename column total_working_hours to total_working_days;
update public.projects set total_working_days = round(total_working_days / 8 * 2) / 2;
alter table public.projects drop constraint if exists projects_total_working_hours_check;
alter table public.projects add constraint projects_total_working_days_check
  check (total_working_days >= 0 and total_working_days = round(total_working_days * 2) / 2);
