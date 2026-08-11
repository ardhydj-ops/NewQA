-- QA Resource Manager v4 — JIRA/Jiva tracking links on work items.
-- Run via Supabase Dashboard -> SQL Editor -> paste -> Run.

alter table public.projects
  add column if not exists jira_link text not null default '',
  add column if not exists jiva_link text not null default '';
