-- Testing Tasks — standalone feature untuk tracking progress testing aplikasi.
-- Jalankan via Supabase Dashboard → SQL Editor → paste → Run.
-- Tidak terhubung ke tabel/feature finance manapun.

create table if not exists public.testing_tasks (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  description       text,
  status            text not null default 'not_started'
                    check (status in ('not_started', 'in_progress', 'passed', 'failed', 'blocked')),
  priority          text not null default 'medium'
                    check (priority in ('low', 'medium', 'high')),
  start_date        date not null default current_date,
  due_date          date,
  total_tc          integer not null default 0 check (total_tc >= 0),
  ok_count          integer not null default 0 check (ok_count >= 0),
  nok_count         integer not null default 0 check (nok_count >= 0),
  na_count          integer not null default 0 check (na_count >= 0),
  total_execute_tc  integer not null default 0 check (total_execute_tc >= 0),
  total_passed_tc   integer not null default 0 check (total_passed_tc >= 0),
  created_at        timestamptz not null default timezone('utc', now()),
  updated_at        timestamptz not null default timezone('utc', now())
);

create index if not exists testing_tasks_start_date_idx
  on public.testing_tasks (start_date desc);

-- updated_at otomatis di-bump setiap UPDATE.
create or replace function public.set_testing_tasks_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists testing_tasks_set_updated_at on public.testing_tasks;

create trigger testing_tasks_set_updated_at
  before update on public.testing_tasks
  for each row
  execute function public.set_testing_tasks_updated_at();

-- RLS — permissive (single-user app, no auth UI yet), sama seperti transactions.
alter table public.testing_tasks enable row level security;

create policy "Permissive rules for all"
  on public.testing_tasks
  for all
  using (true)
  with check (true);
