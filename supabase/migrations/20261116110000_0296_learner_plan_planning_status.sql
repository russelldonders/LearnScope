-- A plan can now be in preparation before it's used: 'planning' is for a
-- plan still being put together, 'active' for one the learner is working
-- through. New plans start in 'planning' and the learner makes them ready
-- when they're set up. Plans that already exist keep their status: they were
-- created as active and may already be in use.
alter table public.learner_plans
  drop constraint learner_plans_status_check,
  add constraint learner_plans_status_check
    check (status in ('planning', 'active', 'completed', 'archived'));

alter table public.learner_plans
  alter column status set default 'planning';
