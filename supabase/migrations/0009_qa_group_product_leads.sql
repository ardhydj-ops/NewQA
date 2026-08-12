alter table public.qa_groups add column lead_user_id uuid references public.profiles(id);
alter table public.products add column qa_group_id uuid references public.qa_groups(id);

create index qa_groups_lead_user_id_idx on public.qa_groups (lead_user_id);
create index products_qa_group_id_idx on public.products (qa_group_id);
