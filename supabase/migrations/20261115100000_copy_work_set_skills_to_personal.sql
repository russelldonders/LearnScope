-- Skills set for you on a work account also join your linked personal
-- account.
--
-- A learner may have a work login (work_sso / work_managed) where an
-- employer or manager sets skills for them, and a personal login they keep
-- when they leave. Once the two are verified as the same person
-- (verified_account_links, status 'active'), the skills set for them on the
-- work account are now added to the personal account's own list too:
--   - only work -> personal; nothing from a personal account is sent on;
--   - the skill only, linked to the same library skill -- not the
--     employer's target level or date, which stay with the work account;
--   - the same safeguards as 20261115090000's add_skill_for_target: never a
--     duplicate, a dropped skill stays dropped, a same-named unlinked skill
--     is linked instead, hidden from the public profile, no level;
--   - copies are the personal account's own records: unlinking later leaves
--     them in place.
--
-- "Set for you" on the work account means a skill an employer or manager
-- put there: an active manager_skill_targets row, or a skill added by
-- accepting a role profile (source 'role_profile') or by a target
-- (source 'manager_target'). Copying happens when one appears while linked,
-- and once for everything already there when the accounts are linked.
--
-- Rollback: drop the two new triggers and three functions, and restore
-- private.manager_target_adds_skill from 20261115090000. Copied skills carry
-- source 'manager_target' on the personal account.

-- Personal accounts actively linked to this work login (none for a personal
-- login, so a copy never travels on further).
create or replace function private.linked_personal_user_ids(p_work_user_id uuid)
 returns setof uuid
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select personal.auth_user_id
  from public.person_auth_accounts work
  join public.verified_account_links link
    on link.status = 'active'
   and (link.auth_account_a_id = work.id or link.auth_account_b_id = work.id)
  join public.person_auth_accounts personal
    on personal.id = case when link.auth_account_a_id = work.id then link.auth_account_b_id else link.auth_account_a_id end
  where work.auth_user_id = p_work_user_id
    and work.account_type in ('work_sso', 'work_managed')
    and personal.account_type = 'personal'
$function$;

create or replace function private.copy_set_skill_to_linked_personal(p_work_user_id uuid, p_library_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_personal_user_id uuid;
begin
  if p_library_id is null then
    return;
  end if;
  for v_personal_user_id in select private.linked_personal_user_ids(p_work_user_id) loop
    perform private.add_skill_for_target(v_personal_user_id, p_library_id);
  end loop;
end;
$function$;

revoke all on function private.linked_personal_user_ids(uuid) from public;
revoke all on function private.copy_set_skill_to_linked_personal(uuid, uuid) from public;

-- A target set on the work account: its skill there (20261115090000) and,
-- now, on the linked personal account -- even when the work account already
-- had the skill.
create or replace function private.manager_target_adds_skill()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    if not exists (select 1 from public.skills where id = new.skill_id and user_id = new.learner_id) then
      perform private.add_skill_for_target(new.learner_id, new.skill_library_id);
    end if;
    perform private.copy_set_skill_to_linked_personal(
      new.learner_id,
      coalesce(new.skill_library_id, (select library_skill_id from public.skills where id = new.skill_id))
    );
  end if;
  return new;
end;
$function$;

-- A skill added to a work account by a role profile or a target.
create or replace function private.set_skill_copies_to_linked_personal()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.source in ('role_profile', 'manager_target') and new.library_skill_id is not null then
    perform private.copy_set_skill_to_linked_personal(new.user_id, new.library_skill_id);
  end if;
  return new;
end;
$function$;

create trigger set_skill_copies_to_linked_personal
  after insert on public.skills
  for each row execute function private.set_skill_copies_to_linked_personal();

-- Linking a work and a personal account: everything already set for you on
-- the work side, once.
create or replace function private.link_copies_set_skills()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_work_user_id uuid;
  v_library_id uuid;
begin
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then
    return new;
  end if;
  for v_work_user_id in
    select auth_user_id from public.person_auth_accounts
    where id in (new.auth_account_a_id, new.auth_account_b_id)
      and account_type in ('work_sso', 'work_managed')
  loop
    for v_library_id in
      select skill_library_id from public.manager_skill_targets
      where learner_id = v_work_user_id and status = 'active' and skill_library_id is not null
      union
      select library_skill_id from public.skills
      where user_id = v_work_user_id and source in ('role_profile', 'manager_target') and library_skill_id is not null
    loop
      perform private.copy_set_skill_to_linked_personal(v_work_user_id, v_library_id);
    end loop;
  end loop;
  return new;
end;
$function$;

create trigger link_copies_set_skills
  after insert or update of status on public.verified_account_links
  for each row execute function private.link_copies_set_skills();

-- Accounts already linked, once.
do $$
declare
  r record;
  v_library_id uuid;
begin
  for r in
    select work.auth_user_id as work_user_id
    from public.verified_account_links link
    join public.person_auth_accounts work on work.id in (link.auth_account_a_id, link.auth_account_b_id)
    where link.status = 'active' and work.account_type in ('work_sso', 'work_managed')
  loop
    for v_library_id in
      select skill_library_id from public.manager_skill_targets
      where learner_id = r.work_user_id and status = 'active' and skill_library_id is not null
      union
      select library_skill_id from public.skills
      where user_id = r.work_user_id and source in ('role_profile', 'manager_target') and library_skill_id is not null
    loop
      perform private.copy_set_skill_to_linked_personal(r.work_user_id, v_library_id);
    end loop;
  end loop;
end $$;
