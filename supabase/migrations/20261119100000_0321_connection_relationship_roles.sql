-- The People page says how the learner and each connection relate: which
-- teams they share and who leads them, and whether one is the other's
-- manager at an employer. Both facts already exist (manager_team_memberships
-- .role, employer_management_relationships); this only lets the learner read
-- their own side of them for people they're connected to.
--
-- Not destructive: no table or data changes. Rollback: restore
-- list_my_shared_teams_by_connection from 20260907190000 and drop
-- list_my_line_management_with_connections.

-- 1. Shared teams now say each person's role in the team. The return shape
-- gains two columns, which create-or-replace can't do, so it is recreated.
-- Its only caller is the People page (listMySharedTeamsByConnection).
drop function public.list_my_shared_teams_by_connection();

create function public.list_my_shared_teams_by_connection()
returns table (
  connection_user_id uuid,
  team_id uuid,
  team_name text,
  team_status text,
  membership_status text,
  my_role text,
  their_role text
)
language sql stable security definer set search_path = '' as $$
  select other.member_user_id, mt.id, mt.name, mt.status, other.status, mine.role, other.role
  from public.manager_team_memberships mine
  join public.manager_teams mt on mt.id = mine.team_id
  join public.manager_team_memberships other on other.team_id = mine.team_id
    and other.member_user_id <> auth.uid()
  join public.connections c on
    c.user_a_id = least(auth.uid(), other.member_user_id)
    and c.user_b_id = greatest(auth.uid(), other.member_user_id)
  where mine.member_user_id = auth.uid() and mine.status = 'active'
    and (
      other.status = 'active'
      or (other.status = 'pending' and private.can_manage_manager_team(mine.team_id, auth.uid()))
    )
$$;

revoke all on function public.list_my_shared_teams_by_connection() from public, anon;
grant execute on function public.list_my_shared_teams_by_connection() to authenticated;

-- 2. Current, direct management relationships at an employer between the
-- learner and someone they're connected to, in either direction. Only ones
-- the learner is a party to -- the same rows the table's own select policy
-- (20260921075057) already shows them -- and only while both are active
-- members and the relationship is in effect. Indirect reports aren't listed.
create function public.list_my_line_management_with_connections()
returns table (
  connection_user_id uuid,
  employer_name text,
  relationship_type text,
  is_primary boolean,
  direction text
)
language sql stable security definer set search_path = '' as $$
  select
    case when manager.user_id = auth.uid() then employee.user_id else manager.user_id end,
    o.name,
    r.relationship_type,
    r.is_primary,
    case when manager.user_id = auth.uid() then 'manages_them' else 'manages_me' end
  from public.employer_management_relationships r
  join public.employer_members manager on manager.id = r.manager_member_id and manager.status = 'active'
  join public.employer_members employee on employee.id = r.employee_member_id and employee.status = 'active'
  join public.organisations o on o.id = r.employer_id
  join public.connections c on
    c.user_a_id = least(manager.user_id, employee.user_id)
    and c.user_b_id = greatest(manager.user_id, employee.user_id)
  where auth.uid() in (manager.user_id, employee.user_id)
    and manager.user_id <> employee.user_id
    and r.valid_from <= current_date
    and (r.valid_until is null or r.valid_until > current_date)
$$;

revoke all on function public.list_my_line_management_with_connections() from public, anon;
grant execute on function public.list_my_line_management_with_connections() to authenticated;
