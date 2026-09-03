-- Independent manager workspaces and consent-based collaborative teams.
--
-- A manager is an individual, not an employer tenant. Membership never grants
-- access to a learner's profile tables. The only learner-owned data exposed to
-- the manager domain is the explicit skill allow-list projected by
-- list_manager_team_shared_skills().

create table manager_teams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index manager_teams_workspace_idx on manager_teams (workspace_id, status);

create table manager_team_memberships (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references manager_teams(id) on delete cascade,
  member_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('manager', 'member')),
  status text not null default 'pending' check (status in ('pending', 'active', 'declined', 'left', 'removed')),
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (team_id, member_user_id)
);

create index manager_team_memberships_user_idx
  on manager_team_memberships (member_user_id, status);

create table manager_team_shared_skills (
  membership_id uuid not null references manager_team_memberships(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  shared_at timestamptz not null default now(),
  primary key (membership_id, skill_id)
);

create table manager_team_learning_activities (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references manager_teams(id) on delete cascade,
  catalogue_course_id uuid references course_catalogue(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 160),
  instructions text,
  due_at timestamptz,
  status text not null default 'active' check (status in ('active', 'closed', 'cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index manager_team_learning_activities_team_idx
  on manager_team_learning_activities (team_id, status);

create table manager_team_activity_participants (
  activity_id uuid not null references manager_team_learning_activities(id) on delete cascade,
  membership_id uuid not null references manager_team_memberships(id) on delete cascade,
  status text not null default 'invited'
    check (status in ('invited', 'accepted', 'started', 'completed', 'declined')),
  updated_at timestamptz not null default now(),
  primary key (activity_id, membership_id)
);

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.can_manage_manager_workspace(p_workspace_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.workspace_access wa
    join public.person_auth_accounts paa on paa.id = wa.auth_account_id
    join public.workspaces w on w.id = wa.workspace_id
    where wa.workspace_id = p_workspace_id
      and paa.auth_user_id = p_user_id
      and paa.status = 'active' and wa.status = 'active'
      and wa.access_role in ('owner', 'manager')
      and w.workspace_type = 'manager' and w.status = 'active'
  )
$$;

create or replace function private.can_manage_manager_team(p_team_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.manager_teams mt
    where mt.id = p_team_id
      and private.can_manage_manager_workspace(mt.workspace_id, p_user_id)
  )
$$;

revoke all on function private.can_manage_manager_workspace(uuid, uuid) from public;
revoke all on function private.can_manage_manager_team(uuid, uuid) from public;
grant execute on function private.can_manage_manager_workspace(uuid, uuid) to authenticated;
grant execute on function private.can_manage_manager_team(uuid, uuid) to authenticated;

create or replace function create_manager_workspace(p_name text default 'My manager workspace')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_person_id uuid; v_account_id uuid; v_workspace_id uuid;
begin
  if nullif(trim(p_name), '') is null then raise exception 'Workspace name is required'; end if;
  select paa.person_id, paa.id into v_person_id, v_account_id
  from public.person_auth_accounts paa
  where paa.auth_user_id = auth.uid() and paa.status = 'active';
  if v_person_id is null then raise exception 'No active person account'; end if;

  select id into v_workspace_id from public.workspaces
  where workspace_type = 'manager' and owner_person_id = v_person_id and status = 'active'
  order by created_at limit 1;
  if v_workspace_id is not null then return v_workspace_id; end if;

  insert into public.workspaces (workspace_type, name, owner_person_id)
  values ('manager', trim(p_name), v_person_id) returning id into v_workspace_id;
  insert into public.workspace_access (workspace_id, auth_account_id, access_role, granted_by)
  values (v_workspace_id, v_account_id, 'owner', auth.uid());
  return v_workspace_id;
end $$;

create or replace function create_manager_team(p_workspace_id uuid, p_name text, p_description text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_team_id uuid;
begin
  if not private.can_manage_manager_workspace(p_workspace_id, auth.uid()) then raise exception 'Not authorised'; end if;
  insert into public.manager_teams (workspace_id, name, description, created_by)
  values (p_workspace_id, trim(p_name), nullif(trim(p_description), ''), auth.uid()) returning id into v_team_id;
  insert into public.manager_team_memberships (team_id, member_user_id, role, status, invited_by, decided_at)
  values (v_team_id, auth.uid(), 'manager', 'active', auth.uid(), now());
  return v_team_id;
end $$;

create or replace function invite_connection_to_manager_team(p_team_id uuid, p_member_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_membership_id uuid;
begin
  if not private.can_manage_manager_team(p_team_id, auth.uid()) then raise exception 'Not authorised'; end if;
  if p_member_user_id = auth.uid() or not exists (
    select 1 from public.connections c
    where c.user_a_id = least(auth.uid(), p_member_user_id)
      and c.user_b_id = greatest(auth.uid(), p_member_user_id)
  ) then
    raise exception 'Team invitations are limited to existing connections';
  end if;
  insert into public.manager_team_memberships (team_id, member_user_id, invited_by)
  values (p_team_id, p_member_user_id, auth.uid())
  on conflict (team_id, member_user_id) do update
    set status = 'pending', role = 'member', invited_by = auth.uid(), invited_at = now(), decided_at = null
    where manager_team_memberships.status in ('declined', 'left', 'removed')
  returning id into v_membership_id;
  if v_membership_id is null then raise exception 'This person already has a live team membership'; end if;
  return v_membership_id;
end $$;

create or replace function decide_manager_team_invite(p_membership_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.manager_team_memberships
  set status = case when p_accept then 'active' else 'declined' end, decided_at = now()
  where id = p_membership_id and member_user_id = auth.uid() and role = 'member' and status = 'pending';
  if not found then raise exception 'Pending invitation not found'; end if;
end $$;

create or replace function set_manager_team_shared_skills(p_membership_id uuid, p_skill_ids uuid[] default '{}')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.manager_team_memberships m where m.id = p_membership_id and m.member_user_id = auth.uid() and m.status = 'active') then
    raise exception 'Active membership not found';
  end if;
  if exists (select 1 from unnest(p_skill_ids) x where not exists (select 1 from public.skills s where s.id = x and s.user_id = auth.uid())) then
    raise exception 'Only your own skills can be shared';
  end if;
  delete from public.manager_team_shared_skills where membership_id = p_membership_id;
  insert into public.manager_team_shared_skills (membership_id, skill_id)
  select p_membership_id, x from unnest(p_skill_ids) x on conflict do nothing;
end $$;

create or replace function create_manager_team_activity(
  p_team_id uuid, p_title text, p_catalogue_course_id uuid default null,
  p_instructions text default null, p_due_at timestamptz default null, p_membership_ids uuid[] default '{}'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_activity_id uuid;
begin
  if not private.can_manage_manager_team(p_team_id, auth.uid()) then raise exception 'Not authorised'; end if;
  insert into public.manager_team_learning_activities (team_id, catalogue_course_id, title, instructions, due_at, created_by)
  values (p_team_id, p_catalogue_course_id, trim(p_title), nullif(trim(p_instructions), ''), p_due_at, auth.uid()) returning id into v_activity_id;
  insert into public.manager_team_activity_participants (activity_id, membership_id)
  select v_activity_id, m.id from public.manager_team_memberships m
  where m.team_id = p_team_id and m.status = 'active' and m.id = any(p_membership_ids)
  on conflict do nothing;
  return v_activity_id;
end $$;

create or replace function list_manager_team_shared_skills(p_team_id uuid)
returns table (membership_id uuid, member_user_id uuid, skill_id uuid, name text, category text, practical_level integer, knowledge_level integer)
language sql stable security definer set search_path = '' as $$
  select m.id, m.member_user_id, s.id, s.name, s.category, s.level, s.knowledge_level
  from public.manager_team_memberships m
  join public.manager_team_shared_skills ss on ss.membership_id = m.id
  join public.skills s on s.id = ss.skill_id and s.user_id = m.member_user_id
  where m.team_id = p_team_id and m.status = 'active'
    and (m.member_user_id = auth.uid() or private.can_manage_manager_team(p_team_id, auth.uid()))
$$;

revoke all on function create_manager_workspace(text), create_manager_team(uuid,text,text), invite_connection_to_manager_team(uuid,uuid), decide_manager_team_invite(uuid,boolean), set_manager_team_shared_skills(uuid,uuid[]), create_manager_team_activity(uuid,text,uuid,text,timestamptz,uuid[]), list_manager_team_shared_skills(uuid) from public, anon;
grant execute on function create_manager_workspace(text), create_manager_team(uuid,text,text), invite_connection_to_manager_team(uuid,uuid), decide_manager_team_invite(uuid,boolean), set_manager_team_shared_skills(uuid,uuid[]), create_manager_team_activity(uuid,text,uuid,text,timestamptz,uuid[]), list_manager_team_shared_skills(uuid) to authenticated;

grant select on manager_teams, manager_team_memberships, manager_team_shared_skills, manager_team_learning_activities, manager_team_activity_participants to authenticated;
alter table manager_teams enable row level security;
alter table manager_team_memberships enable row level security;
alter table manager_team_shared_skills enable row level security;
alter table manager_team_learning_activities enable row level security;
alter table manager_team_activity_participants enable row level security;

create policy "Managers and invited members can view teams" on manager_teams for select to authenticated using (
  private.can_manage_manager_workspace(workspace_id, (select auth.uid())) or exists (
    select 1 from manager_team_memberships m where m.team_id = manager_teams.id and m.member_user_id = (select auth.uid()) and m.status in ('pending','active')
  )
);
create policy "Managers and members can view scoped memberships" on manager_team_memberships for select to authenticated using (
  member_user_id = (select auth.uid()) or private.can_manage_manager_team(team_id, (select auth.uid()))
);
create policy "Owners and team managers can view shared skill links" on manager_team_shared_skills for select to authenticated using (
  exists (select 1 from manager_team_memberships m where m.id = membership_id and (m.member_user_id = (select auth.uid()) or private.can_manage_manager_team(m.team_id, (select auth.uid()))))
);
create policy "Active team participants can view collaborative activities" on manager_team_learning_activities for select to authenticated using (
  private.can_manage_manager_team(team_id, (select auth.uid())) or exists (select 1 from manager_team_memberships m where m.team_id = manager_team_learning_activities.team_id and m.member_user_id = (select auth.uid()) and m.status = 'active')
);
create policy "Participants can view team activity invitations" on manager_team_activity_participants for select to authenticated using (
  exists (select 1 from manager_team_memberships m join manager_team_learning_activities a on a.team_id = m.team_id where m.id = membership_id and a.id = activity_id and (m.member_user_id = (select auth.uid()) or private.can_manage_manager_team(a.team_id, (select auth.uid()))))
);
