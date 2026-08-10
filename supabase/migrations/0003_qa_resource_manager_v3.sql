-- QA Resource Manager v3 — QA Group / Product become CRUD-managed lookup
-- tables (replacing the old hardcoded enums), project-QA visibility, and
-- date-range planning period support (no schema change needed for that part).
-- Run via Supabase Dashboard -> SQL Editor -> paste -> Run.
--
-- NOTE: this is a one-time destructive cutover (drops profiles.qa_group and
-- projects.product after backfilling their replacements). Do not re-run
-- after it succeeds.

create table if not exists public.qa_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);

create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);

drop trigger if exists qa_groups_set_updated_at on public.qa_groups;
create trigger qa_groups_set_updated_at
  before update on public.qa_groups
  for each row execute function public.set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

alter table public.qa_groups enable row level security;
alter table public.products enable row level security;

create policy "Authenticated read" on public.qa_groups
  for select using (auth.role() = 'authenticated');
create policy "Authenticated read" on public.products
  for select using (auth.role() = 'authenticated');

-- Seed with today's hardcoded labels, in their current display order.
insert into public.qa_groups (name) values
  ('QRIS H2H'), ('QRIS BO'), ('Digital H2H'), ('Digital BO'), ('Corporate IT')
on conflict (name) do nothing;

insert into public.products (name) values
  ('QRIS H2H'), ('QRIS BO'), ('QRCB'), ('PI'), ('JV'), ('CCW')
on conflict (name) do nothing;

alter table public.profiles add column if not exists qa_group_id uuid references public.qa_groups(id);
alter table public.projects add column if not exists product_id uuid references public.products(id);

update public.profiles set qa_group_id = (
  select id from public.qa_groups where name = case profiles.qa_group
    when 'qris_h2h' then 'QRIS H2H'
    when 'qris_bo' then 'QRIS BO'
    when 'digital_h2h' then 'Digital H2H'
    when 'digital_bo' then 'Digital BO'
    when 'corporate_it' then 'Corporate IT'
  end
) where qa_group_id is null and qa_group is not null;

update public.projects set product_id = (
  select id from public.products where name = case projects.product
    when 'qris_h2h' then 'QRIS H2H'
    when 'qris_bo' then 'QRIS BO'
    when 'qrcb' then 'QRCB'
    when 'pi' then 'PI'
    when 'jv' then 'JV'
    when 'ccw' then 'CCW'
  end
) where product_id is null;

alter table public.projects alter column product_id set not null;

alter table public.profiles drop column qa_group;
alter table public.projects drop column product;

create index if not exists qa_groups_name_idx on public.qa_groups (name);
create index if not exists products_name_idx on public.products (name);
create index if not exists profiles_qa_group_id_idx on public.profiles (qa_group_id);
create index if not exists projects_product_id_idx on public.projects (product_id);
