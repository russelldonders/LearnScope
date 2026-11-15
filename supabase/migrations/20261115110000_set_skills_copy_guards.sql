-- Follow-up to 20261115090000/20261115100000, from their security review.
--
-- 1. The skill-adding helpers write skills for any user id they're given.
--    They're only ever called from triggers, and signed-in users can't
--    reach them on Staging, but that rested on default grants: revoke
--    explicitly from every API role so it holds wherever this runs.
--
-- 2. Copying set skills from a work login to a linked personal one now
--    needs both logins to be active: a suspended or disconnected login
--    neither sends nor receives copies.
--
-- No data changes. Rollback: re-run linked_personal_user_ids from
-- 20261115100000.

revoke all on function private.add_skill_for_target(uuid, uuid) from public, anon, authenticated;
revoke all on function private.copy_set_skill_to_linked_personal(uuid, uuid) from public, anon, authenticated;
revoke all on function private.linked_personal_user_ids(uuid) from public, anon, authenticated;

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
    and work.status = 'active'
    and personal.account_type = 'personal'
    and personal.status = 'active'
$function$;
