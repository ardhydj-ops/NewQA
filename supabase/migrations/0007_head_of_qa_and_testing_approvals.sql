-- Head of QA role + testing document approval workflow.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('qa_lead','qa_member','project_manager','head_of_qa'));

create table public.testing_document_submissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_by uuid not null references public.profiles(id),
  submitted_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  rejection_comment text,
  created_at timestamptz not null default now()
);

create index testing_document_submissions_project_id_idx
  on public.testing_document_submissions (project_id);

alter table public.testing_document_submissions enable row level security;
create policy "Authenticated read" on public.testing_document_submissions
  for select using (auth.role() = 'authenticated');

alter table public.app_settings
  add column if not exists email_notifications_enabled boolean not null default false;
