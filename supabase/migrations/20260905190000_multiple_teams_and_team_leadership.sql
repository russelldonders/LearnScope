-- Leadership is team-scoped. A workspace owner does not retain leadership
-- after transferring a team. created_by remains the historical creator.
create unique index manager_team_one_active_leader_idx
  on public.manager_team_memberships(team_id) where role = 'manager' and status = 'active';

create or replace function private.can_manage_manager_team(p_team_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.manager_team_memberships m
    join public.manager_teams t on t.id = m.team_id
    where m.team_id = p_team_id and m.member_user_id = p_user_id
      and m.role = 'manager' and m.status = 'active' and t.status = 'active'
  );
$$;

create function public.list_my_led_manager_teams()
returns setof public.manager_teams language sql stable security definer set search_path = '' as $$
  select t.* from public.manager_teams t
  where private.can_manage_manager_team(t.id, auth.uid())
  order by t.created_at, t.id;
$$;

create function public.transfer_manager_team_leadership(p_team_id uuid, p_membership_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_successor uuid;
begin
  if auth.uid() is null then raise exception 'Not authorised'; end if;
  -- Serialize leadership changes before checking the current leader.
  perform 1 from public.manager_teams where id = p_team_id for update;
  if not private.can_manage_manager_team(p_team_id, auth.uid()) then raise exception 'Only the current team leader can transfer leadership'; end if;
  select m.member_user_id into v_successor from public.manager_team_memberships m
  where m.id = p_membership_id and m.team_id = p_team_id and m.role = 'member' and m.status = 'active'
  for update;
  if v_successor is null then raise exception 'Choose an active member of this team'; end if;
  update public.manager_team_memberships set role = 'member'
  where team_id = p_team_id and member_user_id = auth.uid() and role = 'manager' and status = 'active';
  update public.manager_team_memberships set role = 'manager' where id = p_membership_id;
  -- Existing consent names the old leader. Members explicitly share again.
  delete from public.manager_team_shared_skills ss using public.manager_team_memberships m
  where ss.membership_id = m.id and m.team_id = p_team_id;
  update public.manager_teams set updated_at = now() where id = p_team_id;
end;
$$;

create or replace function public.list_my_manager_team_relationships()
returns table (id uuid, status text, team_id uuid, team_name text, manager_name text,
  invited_at timestamptz, joined_at timestamptz, shared_skill_ids uuid[])
language sql stable security definer set search_path = '' as $$
  select m.id, m.status, t.id, t.name,
    coalesce(nullif(trim(p.full_name), ''), 'Team leader'), m.invited_at, m.decided_at,
    coalesce(array_agg(ss.skill_id order by ss.shared_at) filter (where ss.skill_id is not null), '{}')
  from public.manager_team_memberships m
  join public.manager_teams t on t.id = m.team_id
  join public.manager_team_memberships leader on leader.team_id = t.id and leader.role = 'manager' and leader.status = 'active'
  join public.profiles p on p.id = leader.member_user_id
  left join public.manager_team_shared_skills ss on ss.membership_id = m.id
  where m.member_user_id = auth.uid() and m.role = 'member'
    and m.status in ('pending', 'active') and t.status = 'active'
  group by m.id, t.id, p.full_name order by m.invited_at desc;
$$;

-- A member leaving concurrently with promotion must not leave a leaderless
-- team. Lock before checking role; retain historical membership dates.
create or replace function public.leave_manager_team(p_membership_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.manager_team_memberships m where m.id = p_membership_id
    and m.member_user_id = auth.uid() and m.role = 'member' and m.status = 'active' for update;
  if not found then raise exception 'Active team membership not found'; end if;
  delete from public.manager_team_shared_skills where membership_id = p_membership_id;
  update public.manager_team_memberships set status = 'left', decided_at = now() where id = p_membership_id;
end;
$$;

revoke all on function public.list_my_led_manager_teams(), public.transfer_manager_team_leadership(uuid, uuid) from public, anon;
grant execute on function public.list_my_led_manager_teams(), public.transfer_manager_team_leadership(uuid, uuid) to authenticated;
