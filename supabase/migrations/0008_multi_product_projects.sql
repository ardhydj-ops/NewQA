-- Many-to-many join, replacing the single projects.product_id column.
create table public.project_products (
  project_id uuid not null references public.projects(id) on delete cascade,
  product_id uuid not null references public.products(id),
  primary key (project_id, product_id)
);
create index project_products_product_id_idx on public.project_products (product_id);

alter table public.project_products enable row level security;
create policy "Authenticated read" on public.project_products
  for select using (auth.role() = 'authenticated');

-- Backfill: every existing project had exactly one product.
insert into public.project_products (project_id, product_id)
select id, product_id from public.projects;

alter table public.projects drop column product_id;

-- Per-product assignment: each allocation now records which product it's for.
alter table public.allocations add column product_id uuid references public.products(id);

-- Backfill: at migration time every project still has exactly one product
-- (the join table row just inserted above), so this is unambiguous.
update public.allocations a
set product_id = pp.product_id
from public.project_products pp
where pp.project_id = a.project_id;

alter table public.allocations alter column product_id set not null;
create index allocations_product_id_idx on public.allocations (product_id);
