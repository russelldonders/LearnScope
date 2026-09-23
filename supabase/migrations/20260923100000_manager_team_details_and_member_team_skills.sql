-- Two small additions for the Teams UI, no schema changes:
--
-- 1. update_manager_team_details -- lets a team's leader rename a team (and
--    set its description) after creating it. Until now name/description
--    were only ever written by create_manager_team, so a team created with a
--    placeholder name (e.g. "My team" from getOrCreateMyDefaultManagerTeam)
--    was stuck with it. Same leader + active-team guards as every other
--    manager-team write RPC; the name check mirrors manager_teams' own
--    constraint so the error is readable rather than a raw check violation.
--
-- 2. list_manager_team_skills_for_member -- lets an active member see the
--    team's tracked-skills list (manager_team_skills), which the leader
--    curates as "skills the team is working on together". Only skill names
--    and library ids leave here: no per-member data, nothing about who has
--    shared what, and not added_by. Scoped the same way as
--    list_manager_team_roster: the caller must hold an active membership of
--    that team. The leader's own view (list_manager_team_skills) and the
--    table's RLS policy are unchanged.

create or replace function public.update_manager_team_details(p_team_id uuid, p_name text, p_description text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_manage_manager_team(p_team_id, auth.uid()) then raise exception 'Not authorised'; end if;
  if not exists (select 1 from public.manager_teams where id = p_team_id and status = 'active') then
    raise exception 'This team has been archived and can no longer be changed';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 120 then
    raise exception 'Team name must be between 1 and 120 characters';
  end if;
  if p_description is not null and char_length(p_description) > 500 then
    raise exception 'Team description must be 500 characters or fewer';
  end if;
  update public.manager_teams
  set name = trim(p_name), description = nullif(trim(p_description), ''), updated_at = now()
  where id = p_team_id;
end;
$$;

create or replace function public.list_manager_team_skills_for_member(p_team_id uuid)
returns table (id uuid, skill_library_id uuid, skill_name text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.skill_library_id, s.skill_name
  from public.manager_team_skills s
  where s.team_id = p_team_id
    and exists (
      select 1 from public.manager_team_memberships me
      where me.team_id = p_team_id and me.member_user_id = auth.uid() and me.status = 'active'
    )
  order by s.skill_name
$$;

revoke all on function public.update_manager_team_details(uuid, text, text), public.list_manager_team_skills_for_member(uuid) from public, anon;
grant execute on function public.update_manager_team_details(uuid, text, text), public.list_manager_team_skills_for_member(uuid) to authenticated;
