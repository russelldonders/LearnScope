-- Lets a team leader archive (disband) a manager_teams row instead of
-- deleting it: history, membership, shared skills, ratings, learning and
-- collaboration records all stay intact and viewable, but no new activity
-- can happen against an archived team. manager_teams.status already allowed
-- 'archived' (20260903130000) -- nothing before this migration ever set it.
--
-- private.can_manage_manager_team required t.status = 'active', which meant
-- an archived team's own leader would lose read access to it (every list_*
-- function and RLS select policy built on that helper) the moment it was
-- archived -- the opposite of "keep it around to view". That check is
-- dropped here: the helper now means only "is this user this team's
-- leader", independent of the team's lifecycle. Every *write* RPC that
-- relied on the dropped status check gets its own explicit
-- `t.status = 'active'` guard below, so archiving still freezes new
-- invites, ratings, activities, collaboration records, shared-skill
-- changes, evidence edits and leadership transfers -- only reads stay open.

create or replace function private.can_manage_manager_team(p_team_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.manager_teams mt
    where mt.id = p_team_id
      and private.can_manage_manager_workspace(mt.workspace_id, p_user_id)
  )
$$;

-- Explicit status filter now that the helper above no longer implies it --
-- keeps this the same "active teams I lead" list it always was.
create or replace function public.list_my_led_manager_teams()
returns setof public.manager_teams language sql stable security definer set search_path = '' as $$
  select t.* from public.manager_teams t
  where t.status = 'active' and private.can_manage_manager_team(t.id, auth.uid())
  order by t.created_at, t.id;
$$;

create or replace function public.list_my_archived_manager_teams()
returns setof public.manager_teams language sql stable security definer set search_path = '' as $$
  select t.* from public.manager_teams t
  where t.status = 'archived' and private.can_manage_manager_team(t.id, auth.uid())
  order by t.updated_at desc, t.id;
$$;

create or replace function public.archive_manager_team(p_team_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_manage_manager_team(p_team_id, auth.uid()) then raise exception 'Not authorised'; end if;
  update public.manager_teams set status = 'archived', updated_at = now()
  where id = p_team_id and status = 'active';
  if not found then raise exception 'Team not found, or already archived'; end if;
end $$;

create or replace function public.restore_manager_team(p_team_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_manage_manager_team(p_team_id, auth.uid()) then raise exception 'Not authorised'; end if;
  update public.manager_teams set status = 'active', updated_at = now()
  where id = p_team_id and status = 'archived';
  if not found then raise exception 'Team not found, or not archived'; end if;
end $$;

revoke all on function public.list_my_archived_manager_teams(), public.archive_manager_team(uuid), public.restore_manager_team(uuid) from public, anon;
grant execute on function public.list_my_archived_manager_teams(), public.archive_manager_team(uuid), public.restore_manager_team(uuid) to authenticated;

-- Write RPCs: add back an explicit "team is active" guard everywhere the
-- dropped status check used to cover it.

create or replace function public.invite_connection_to_manager_team(p_team_id uuid, p_member_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_membership_id uuid;
begin
  if not private.can_manage_manager_team(p_team_id, auth.uid()) then raise exception 'Not authorised'; end if;
  if not exists (select 1 from public.manager_teams where id = p_team_id and status = 'active') then
    raise exception 'This team has been archived and can no longer be changed';
  end if;
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

create or replace function public.invite_connection_to_manager_team_by_email(p_team_id uuid, p_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_member_user_id uuid;
  v_membership_id uuid;
  v_email text := lower(trim(p_email));
begin
  if not private.can_manage_manager_team(p_team_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;
  if not exists (select 1 from public.manager_teams where id = p_team_id and status = 'active') then
    raise exception 'This team has been archived and can no longer be changed';
  end if;
  if v_email = '' then raise exception 'Email is required'; end if;

  select u.id into v_member_user_id
  from auth.users u
  where lower(u.email) = v_email;

  if v_member_user_id is null or v_member_user_id = auth.uid() or not exists (
    select 1 from public.connections c
    where c.user_a_id = least(auth.uid(), v_member_user_id)
      and c.user_b_id = greatest(auth.uid(), v_member_user_id)
  ) then
    raise exception 'No existing connection was found for that email';
  end if;

  insert into public.manager_team_memberships
    (team_id, member_user_id, invited_email, invited_by)
  values (p_team_id, v_member_user_id, v_email, auth.uid())
  on conflict (team_id, member_user_id) do update
    set status = 'pending', role = 'member', invited_email = excluded.invited_email,
        invited_by = auth.uid(), invited_at = now(), decided_at = null
    where manager_team_memberships.status in ('declined', 'left', 'removed')
  returning id into v_membership_id;

  if v_membership_id is null then
    raise exception 'This person already has a live team membership';
  end if;
  return v_membership_id;
end $$;

create or replace function public.create_manager_team_activity(
  p_team_id uuid, p_title text, p_catalogue_course_id uuid default null,
  p_instructions text default null, p_due_at timestamptz default null, p_membership_ids uuid[] default '{}'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_activity_id uuid;
begin
  if not private.can_manage_manager_team(p_team_id, auth.uid()) then raise exception 'Not authorised'; end if;
  if not exists (select 1 from public.manager_teams where id = p_team_id and status = 'active') then
    raise exception 'This team has been archived and can no longer be changed';
  end if;
  insert into public.manager_team_learning_activities (team_id, catalogue_course_id, title, instructions, due_at, created_by)
  values (p_team_id, p_catalogue_course_id, trim(p_title), nullif(trim(p_instructions), ''), p_due_at, auth.uid()) returning id into v_activity_id;
  insert into public.manager_team_activity_participants (activity_id, membership_id)
  select v_activity_id, m.id from public.manager_team_memberships m
  where m.team_id = p_team_id and m.status = 'active' and m.id = any(p_membership_ids)
  on conflict do nothing;
  return v_activity_id;
end $$;

create or replace function public.create_manager_collaboration_record(
  p_team_id uuid,
  p_title text,
  p_note text,
  p_membership_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_record_id uuid;
begin
  if not private.can_manage_manager_team(p_team_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;
  if not exists (select 1 from public.manager_teams where id = p_team_id and status = 'active') then
    raise exception 'This team has been archived and can no longer be changed';
  end if;
  if coalesce(array_length(p_membership_ids, 1), 0) = 0 then
    raise exception 'Choose at least one team member';
  end if;
  if exists (
    select 1 from unnest(p_membership_ids) id
    where not exists (
      select 1 from public.manager_team_memberships m
      where m.id = id and m.team_id = p_team_id
        and m.role = 'member' and m.status = 'active'
    )
  ) then raise exception 'Every selected person must be an active team member'; end if;

  insert into public.manager_collaboration_records (team_id, title, note, created_by)
  values (p_team_id, trim(p_title), trim(p_note), auth.uid())
  returning id into v_record_id;

  insert into public.manager_collaboration_record_members (record_id, membership_id)
  select v_record_id, id from unnest(p_membership_ids) id;
  return v_record_id;
end
$$;

create or replace function public.create_manager_team_skill_assessment(
  p_membership_id uuid, p_skill_id uuid, p_level int, p_comments text default null, p_evidence_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_team_id uuid; v_id uuid;
begin
  select m.team_id into v_team_id
  from public.manager_team_memberships m
  where m.id = p_membership_id and m.role = 'member' and m.status = 'active';
  if v_team_id is null then raise exception 'Active team member not found'; end if;
  if not private.can_manage_manager_team(v_team_id, auth.uid()) then raise exception 'Not authorised'; end if;
  if not exists (select 1 from public.manager_teams where id = v_team_id and status = 'active') then
    raise exception 'This team has been archived and can no longer be changed';
  end if;
  if not exists (
    select 1 from public.manager_team_shared_skills ss
    where ss.membership_id = p_membership_id and ss.skill_id = p_skill_id
  ) then raise exception 'This skill has not been shared with your team'; end if;

  insert into public.manager_team_skill_assessments
    (membership_id, skill_id, level, comments, evidence_url, assessed_by)
  values
    (p_membership_id, p_skill_id, p_level, nullif(trim(p_comments), ''), nullif(trim(p_evidence_url), ''), auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

-- Editing an existing rating's evidence is still a change, not a read, so it
-- freezes too rather than only new ratings.
create or replace function public.set_manager_team_skill_assessment_evidence(p_assessment_id uuid, p_evidence_paths text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.manager_team_skill_assessments a
  set evidence_paths = p_evidence_paths
  where a.id = p_assessment_id and a.assessed_by = auth.uid()
    and exists (
      select 1 from public.manager_team_memberships m
      join public.manager_teams t on t.id = m.team_id
      where m.id = a.membership_id and t.status = 'active'
    );
  if not found then raise exception 'Assessment not found'; end if;
end
$$;

-- A member changing what they share is also new activity against the team,
-- so it freezes along with everything the leader does.
create or replace function public.set_manager_team_shared_skills(p_membership_id uuid, p_skill_ids uuid[] default '{}')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.manager_team_memberships m
    join public.manager_teams t on t.id = m.team_id
    where m.id = p_membership_id and m.member_user_id = auth.uid() and m.status = 'active' and t.status = 'active'
  ) then
    raise exception 'Active membership not found';
  end if;
  if exists (select 1 from unnest(p_skill_ids) x where not exists (select 1 from public.skills s where s.id = x and s.user_id = auth.uid())) then
    raise exception 'Only your own skills can be shared';
  end if;
  delete from public.manager_team_shared_skills where membership_id = p_membership_id;
  insert into public.manager_team_shared_skills (membership_id, skill_id)
  select p_membership_id, x from unnest(p_skill_ids) x on conflict do nothing;
end $$;

create or replace function public.set_manager_team_skill_target(
  p_membership_id uuid, p_skill_id uuid, p_target_level int, p_target_date date, p_comments text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_learner uuid; v_target public.skill_targets;
begin
  if auth.uid() is null then raise exception 'Not authorised'; end if;
  if p_target_level is null or p_target_level not between 1 and 5 then raise exception 'Choose a target level'; end if;
  if p_target_date is null then raise exception 'Choose a target date'; end if;
  select m.member_user_id into v_learner
  from public.manager_team_memberships m
  join public.manager_team_shared_skills ss on ss.membership_id = m.id
  join public.skills s on s.id = ss.skill_id and s.user_id = m.member_user_id
  join public.manager_teams t on t.id = m.team_id
  where m.id = p_membership_id and s.id = p_skill_id and m.role = 'member' and m.status = 'active'
    and t.status = 'active' and private.can_manage_manager_team(m.team_id, auth.uid())
  for share of m, ss;
  if v_learner is null then raise exception 'This skill is no longer shared with your team'; end if;
  insert into public.skill_targets (skill_id, user_id, target_level, target_date, comments, set_by_manager)
  values (p_skill_id, v_learner, p_target_level, p_target_date, nullif(trim(p_comments), ''), auth.uid()) returning * into v_target;
  update public.skills set lifecycle_stage = 'target_set' where id = p_skill_id and lifecycle_stage = 'baseline_assessed';
  return to_jsonb(v_target);
end;
$$;

create or replace function public.transfer_manager_team_leadership(p_team_id uuid, p_membership_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_successor uuid;
begin
  if auth.uid() is null then raise exception 'Not authorised'; end if;
  -- Serialize leadership changes before checking the current leader.
  perform 1 from public.manager_teams where id = p_team_id for update;
  if not private.can_manage_manager_team(p_team_id, auth.uid()) then raise exception 'Only the current team leader can transfer leadership'; end if;
  if not exists (select 1 from public.manager_teams where id = p_team_id and status = 'active') then
    raise exception 'This team has been archived and can no longer be changed';
  end if;
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

-- Adds team_status so a member's own joined-team list can keep showing (and
-- gray out) a team after its leader archives it, the same as the leader's
-- own view -- the column set changes, so this needs a drop first.
drop function if exists public.list_my_manager_team_relationships();

create function public.list_my_manager_team_relationships()
returns table (id uuid, status text, team_id uuid, team_name text, manager_name text,
  invited_at timestamptz, joined_at timestamptz, shared_skill_ids uuid[], team_status text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.status, t.id, t.name,
    coalesce(nullif(trim(p.full_name), ''), 'Team leader'), m.invited_at, m.decided_at,
    coalesce(array_agg(ss.skill_id order by ss.shared_at) filter (where ss.skill_id is not null), '{}'),
    t.status
  from public.manager_team_memberships m
  join public.manager_teams t on t.id = m.team_id
  join public.manager_team_memberships leader on leader.team_id = t.id and leader.role = 'manager' and leader.status = 'active'
  join public.profiles p on p.id = leader.member_user_id
  left join public.manager_team_shared_skills ss on ss.membership_id = m.id
  where m.member_user_id = auth.uid() and m.role = 'member'
    and m.status in ('pending', 'active')
  group by m.id, t.id, p.full_name, t.status order by m.invited_at desc;
$$;

revoke all on function public.list_my_manager_team_relationships() from public, anon;
grant execute on function public.list_my_manager_team_relationships() to authenticated;
