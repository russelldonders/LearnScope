-- Phase 3 of merging what managers do across the two management contexts
-- (see 20261001110000, 20261002090000, 20261002100000 and
-- docs/architecture/manager-teams.md). DESTRUCTIVE -- approved by the
-- project owner on 2026-10-02.
--
-- Since phase 2d nothing reads or writes the per-context tables; every row
-- was copied into the unified tables by the phase 1 backfill and mirror
-- triggers, keyed by (legacy_source, legacy_id). This removes them:
--
--   dropped:  manager_team_skill_suggestions, employer_skill_suggestions,
--             manager_team_skill_assessments, employer_skill_confirmations,
--             employer_skill_development_targets
--   deleted:  skill_targets rows a team manager set (set_by_manager is not
--             null) -- they live in manager_skill_targets now, and
--             skill_targets is the learner's own targets only
--   dropped:  list_my_manager_team_skill_suggestions(),
--             list_my_employer_skill_development_targets() (unused readers
--             of the dropped tables)
--
-- Safety: before anything is removed, every row above must have its copy
-- in the unified tables; otherwise the migration aborts and changes
-- nothing. Plain DROP (no CASCADE), so an unexpected dependency also aborts.
--
-- Kept: the skill_targets.set_by_manager column (always null from now on).
-- Deployed app code still filters on it, so it goes in a later release once
-- that code is gone. The unified tables keep legacy_source/legacy_id as a
-- record of where each migrated row came from.
--
-- Rollback: none in SQL -- restore the dropped tables from a database
-- backup. Their data also survives in the unified tables (with the original
-- ids in legacy_id), from which they could be rebuilt.

do $$
declare
  v_missing text;
begin
  select string_agg(source || ': ' || missing, ', ') into v_missing
  from (
    select 'manager_team_skill_suggestions' source, count(*) missing
    from public.manager_team_skill_suggestions old
    where not exists (select 1 from public.manager_skill_suggestions new
      where new.legacy_source = 'manager_team_skill_suggestions' and new.legacy_id = old.id)
    union all
    select 'employer_skill_suggestions', count(*)
    from public.employer_skill_suggestions old
    where not exists (select 1 from public.manager_skill_suggestions new
      where new.legacy_source = 'employer_skill_suggestions' and new.legacy_id = old.id)
    union all
    select 'manager_team_skill_assessments', count(*)
    from public.manager_team_skill_assessments old
    where not exists (select 1 from public.manager_skill_ratings new
      where new.legacy_source = 'manager_team_skill_assessments' and new.legacy_id = old.id)
    union all
    select 'employer_skill_confirmations', count(*)
    from public.employer_skill_confirmations old
    where not exists (select 1 from public.manager_skill_ratings new
      where new.legacy_source = 'employer_skill_confirmations' and new.legacy_id = old.id)
    union all
    select 'employer_skill_development_targets', count(*)
    from public.employer_skill_development_targets old
    where not exists (select 1 from public.manager_skill_targets new
      where new.legacy_source = 'employer_skill_development_targets' and new.legacy_id = old.id)
    union all
    select 'skill_targets (set by a team manager)', count(*)
    from public.skill_targets old
    where old.set_by_manager is not null
      and not exists (select 1 from public.manager_skill_targets new
        where new.legacy_source = 'skill_targets' and new.legacy_id = old.id)
  ) checks
  where missing > 0;

  if v_missing is not null then
    raise exception 'Not removing the old manager action tables: rows without a copy in the unified tables (%)', v_missing;
  end if;
end
$$;

delete from public.skill_targets where set_by_manager is not null;

comment on column public.skill_targets.set_by_manager is
  'No longer written (targets someone else sets are in manager_skill_targets). Always null; to be dropped.';

drop function public.list_my_manager_team_skill_suggestions();
drop function public.list_my_employer_skill_development_targets();

drop table public.manager_team_skill_suggestions;
drop table public.employer_skill_suggestions;
drop table public.manager_team_skill_assessments;
drop table public.employer_skill_confirmations;
drop table public.employer_skill_development_targets;
