-- Distinct from proposed_by (who submitted the proposal — can be a QA
-- Lead via New Item or the Excel import, not always a PM). pm_id is the
-- project's PM owner: auto-set when a PM proposes, otherwise assignable
-- afterward by Head of QA, QA Lead, or any PM.
alter table projects
  add column pm_id uuid references profiles(id);
