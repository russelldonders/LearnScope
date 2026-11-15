-- A target a manager or employer sets puts the skill on the learner's list.
--
-- Until now a target on a library skill the learner didn't track (a
-- manager_skill_targets row with only skill_library_id) attached to nothing:
-- the learner saw it only as a "Set for you" suggestion they had to add. As
-- with role-profile requirements once a role is accepted
-- (20260912170000), the skill now joins their list straight away:
--   - linked to the same library skill, so the target attaches to it;
--   - source 'manager_target' (widening skills.source, as role_profile did),
--     so it's clear the learner didn't add it themselves;
--   - hidden from their public profile until they choose to show it -- they
--     didn't pick it, so it isn't published on their behalf;
--   - lifecycle 'identified', no level: being given a target isn't evidence
--     of any level.
-- Never a duplicate: a skill they already have for that library skill is
-- left as it is, including one they've dropped (their choice stands). A
-- skill of the same name that isn't linked to the library yet is linked to
-- it rather than added twice (names are unique per learner); one linked to
-- a different library skill is left alone and nothing is added.
--
-- Manager suggestions are unchanged: they stay offers the learner accepts.
--
-- Existing active targets get the same treatment once, below (none on
-- Staging when written; Production may have some).
--
-- Rollback: drop the trigger and function; skills added by it carry
-- source 'manager_target' and can be found by that if they need review.
-- Narrowing skills_source_check back would first need those rows' source
-- changed.

alter table public.skills drop constraint skills_source_check;
alter table public.skills add constraint skills_source_check
  check (source in ('manual', 'cv_import', 'recommend', 'external_import', 'role_profile', 'manager_target'));

create or replace function private.add_skill_for_target(p_learner_id uuid, p_library_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_library public.skill_library%rowtype;
  v_same_name_id uuid;
  v_same_name_library uuid;
begin
  if p_library_id is null then
    return;
  end if;
  if exists (select 1 from public.skills where user_id = p_learner_id and library_skill_id = p_library_id) then
    return;
  end if;
  select * into v_library from public.skill_library where id = p_library_id;
  if not found then
    return;
  end if;

  select id, library_skill_id into v_same_name_id, v_same_name_library
  from public.skills
  where user_id = p_learner_id and lower(name) = lower(v_library.name)
  limit 1;

  if v_same_name_id is not null then
    if v_same_name_library is null then
      update public.skills set library_skill_id = p_library_id where id = v_same_name_id;
    end if;
    return;
  end if;

  insert into public.skills (
    user_id, name, category, library_skill_id, source,
    tracking_reason, lifecycle_stage, is_current_role, visible_on_profile
  )
  values (
    p_learner_id, v_library.name, v_library.category, p_library_id, 'manager_target',
    'career_development', 'identified', false, false
  )
  on conflict do nothing;
end;
$function$;

revoke all on function private.add_skill_for_target(uuid, uuid) from public;

create or replace function private.manager_target_adds_skill()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.status = 'active'
    and (tg_op = 'INSERT' or old.status is distinct from 'active')
    and not exists (select 1 from public.skills where id = new.skill_id and user_id = new.learner_id)
  then
    perform private.add_skill_for_target(new.learner_id, new.skill_library_id);
  end if;
  return new;
end;
$function$;

create trigger manager_target_adds_skill
  after insert or update of status on public.manager_skill_targets
  for each row execute function private.manager_target_adds_skill();

-- Existing active targets, once.
do $$
declare
  r record;
begin
  for r in
    select t.learner_id, t.skill_library_id
    from public.manager_skill_targets t
    where t.status = 'active'
      and t.skill_library_id is not null
      and not exists (select 1 from public.skills s where s.id = t.skill_id and s.user_id = t.learner_id)
  loop
    perform private.add_skill_for_target(r.learner_id, r.skill_library_id);
  end loop;
end $$;
