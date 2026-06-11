-- Financial Tracker — initial schema (single-table + pgvector)
-- Run via Supabase Dashboard → SQL Editor → paste → Run

-- ---------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ---------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  type         text not null check (type in ('income', 'expense')),
  category     text not null,
  amount       numeric not null,
  description  text,
  date         date not null default current_date,
  user_id      uuid references auth.users(id) on delete cascade,
  embedding    vector(768),
  created_at   timestamptz not null default timezone('utc', now())
);

create index if not exists transactions_date_idx
  on public.transactions (date desc);

-- ---------------------------------------------------------------
-- RLS — permissive (single-user app, no auth UI yet)
-- ---------------------------------------------------------------
alter table public.transactions enable row level security;

create policy "Permissive rules for all"
  on public.transactions
  for all
  using (true)
  with check (true);
