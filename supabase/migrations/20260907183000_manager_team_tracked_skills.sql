-- Lets a leader add a skill to the team's own "working on together" list
-- without suggesting it to any specific member yet -- previously every
-- add-skill action was a manager_team_skill_suggestions row, which requires
-- a membership_id and so always had to target at least one person. This is
-- deliberately a separate, lightweight table rather than making
-- membership_id nullable on that one: a tracked-but-unsuggested skill has
-- no per-person state at all (no target, no comments, no adopt/dismiss
-- lifecycle), so it isn't really "the same row with a hole in it" -- it's a
-- genuinely different, simpler fact (the team is tracking this skill),
-- which suggesting to a member later builds on top of rather than
-- replaces.
create table manager_team_skills (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references manager_teams(id) on delete cascade,
  skill_library_id uuid not null references skill_library(id),
  skill_name text not null,
  added_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (team_id, skill_library_id)
);

create index manager_team_skills_team_idx on manager_team_skills (team_id);

alter table manager_team_skills enable row level security;

create policy "Team leaders can view their team's tracked skills"
  on manager_team_skills for select to authenticated using (
    private.can_manage_manager_team(team_id, (select auth.uid()))
  );

grant select on table manager_team_skills to authenticated;
-- No direct insert/update/delete grant -- only through the security-definer
-- RPCs below (leader + active-team checks), same convention as every other
-- manager-team mutation.

create or replace function public.add_manager_team_skill(p_team_id uuid, p_skill_library_id uuid, p_skill_name text)
returns public.manager_team_skills
language plpgsql security definer set search_path = '' as $$
declare v_result public.manager_team_skills;
begin
  if not private.can_manage_manager_team(p_team_id, auth.uid()) then raise exception 'Not authorised'; end if;
  if not exists (select 1 from public.manager_teams where id = p_team_id and status = 'active') then
    raise exception 'This team has been archived and can no longer be changed';
  end if;
  insert into public.manager_team_skills (team_id, skill_library_id, skill_name, added_by)
  values (p_team_id, p_skill_library_id, trim(p_skill_name), auth.uid())
  on conflict (team_id, skill_library_id) do update set skill_name = excluded.skill_name
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.list_manager_team_skills(p_team_id uuid)
returns setof public.manager_team_skills
language sql stable security definer set search_path = '' as $$
  select * from public.manager_team_skills
  where team_id = p_team_id and private.can_manage_manager_team(p_team_id, auth.uid())
  order by created_at
$$;

-- Only meaningful for a skill nobody has actually shared yet -- the
-- frontend only ever offers this for a tracked skill with zero real
-- shared-skill data behind it (removing the tracking row wouldn't make an
-- already-shared skill disappear from the matrix anyway, since that's
-- driven by the real skills/manager_team_shared_skills data, not this
-- table).
create or replace function public.remove_manager_team_skill(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_team_id uuid;
begin
  select team_id into v_team_id from public.manager_team_skills where id = p_id;
  if v_team_id is null then raise exception 'Team skill not found'; end if;
  if not private.can_manage_manager_team(v_team_id, auth.uid()) then raise exception 'Not authorised'; end if;
  if not exists (select 1 from public.manager_teams where id = v_team_id and status = 'active') then
    raise exception 'This team has been archived and can no longer be changed';
  end if;
  delete from public.manager_team_skills where id = p_id;
end;
$$;

revoke all on function public.add_manager_team_skill(uuid, uuid, text), public.list_manager_team_skills(uuid), public.remove_manager_team_skill(uuid) from public, anon;
grant execute on function public.add_manager_team_skill(uuid, uuid, text), public.list_manager_team_skills(uuid), public.remove_manager_team_skill(uuid) to authenticated;
