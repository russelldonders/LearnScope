-- Learner-facing consent lifecycle for independent manager teams.
-- These APIs expose only the caller's own memberships and explicit shared-
-- skill ids. Leaving a team removes the share links immediately while
-- retaining the historical membership row as ended relationship metadata.

create or replace function list_my_manager_team_relationships()
returns table (
  id uuid,
  status text,
  team_id uuid,
  team_name text,
  manager_name text,
  invited_at timestamptz,
  joined_at timestamptz,
  shared_skill_ids uuid[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    m.status,
    t.id,
    t.name,
    coalesce(nullif(trim(manager_profile.full_name), ''), 'Your manager'),
    m.invited_at,
    m.decided_at,
    coalesce(array_agg(ss.skill_id order by ss.shared_at)
      filter (where ss.skill_id is not null), '{}')
  from public.manager_team_memberships m
  join public.manager_teams t on t.id = m.team_id
  join public.profiles manager_profile on manager_profile.id = t.created_by
  left join public.manager_team_shared_skills ss on ss.membership_id = m.id
  where m.member_user_id = auth.uid()
    and m.role = 'member'
    and m.status in ('pending', 'active')
    and t.status = 'active'
  group by m.id, t.id, manager_profile.full_name
  order by m.invited_at desc
$$;

create or replace function leave_manager_team(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.manager_team_memberships m
    where m.id = p_membership_id
      and m.member_user_id = auth.uid()
      and m.role = 'member'
      and m.status = 'active'
  ) then
    raise exception 'Active team membership not found';
  end if;

  delete from public.manager_team_shared_skills
  where membership_id = p_membership_id;

  update public.manager_team_memberships
  set status = 'left', decided_at = now()
  where id = p_membership_id;
end
$$;

revoke all on function list_my_manager_team_relationships(), leave_manager_team(uuid)
from public, anon;
grant execute on function list_my_manager_team_relationships(), leave_manager_team(uuid)
to authenticated;
