-- Complete the manager console's read model and manager-authored records.

alter table manager_team_memberships add column invited_email text;

update manager_team_memberships m
set invited_email = lower(u.email)
from auth.users u
where u.id = m.member_user_id;

create table manager_collaboration_records (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references manager_teams(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  note text not null check (char_length(trim(note)) between 1 and 5000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index manager_collaboration_records_team_idx
  on manager_collaboration_records (team_id, created_at desc);

create table manager_collaboration_record_members (
  record_id uuid not null references manager_collaboration_records(id) on delete cascade,
  membership_id uuid not null references manager_team_memberships(id) on delete cascade,
  primary key (record_id, membership_id)
);

create index manager_collaboration_record_members_membership_idx
  on manager_collaboration_record_members (membership_id);

grant select on manager_collaboration_records, manager_collaboration_record_members to authenticated;
alter table manager_collaboration_records enable row level security;
alter table manager_collaboration_record_members enable row level security;

create policy "Managers can view their collaboration records"
  on manager_collaboration_records for select to authenticated
  using (private.can_manage_manager_team(team_id, (select auth.uid())));

create policy "Managers can view collaboration record members"
  on manager_collaboration_record_members for select to authenticated
  using (
    exists (
      select 1
      from manager_collaboration_records r
      where r.id = record_id
        and private.can_manage_manager_team(r.team_id, (select auth.uid()))
    )
  );

create or replace function invite_connection_to_manager_team_by_email(p_team_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_user_id uuid;
  v_membership_id uuid;
  v_email text := lower(trim(p_email));
begin
  if not private.can_manage_manager_team(p_team_id, auth.uid()) then
    raise exception 'Not authorised';
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
    -- Deliberately identical for unknown and non-connected addresses.
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
end
$$;

create or replace function create_manager_collaboration_record(
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

create or replace function list_manager_team_member_summaries(p_team_id uuid)
returns table (
  id uuid, name text, avatar_url text, team_since timestamptz,
  shared_skills jsonb, collaborative_learning_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    coalesce(nullif(trim(p.full_name), ''), 'Team member'),
    p.avatar_url,
    coalesce(m.decided_at, m.invited_at),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'level', s.level,
        'sharedAt', ss.shared_at,
        'evidenceCount', coalesce((
          select sum(coalesce(cardinality(sa.evidence_paths), 0))
          from public.skill_assessments sa where sa.skill_id = s.id
        ), 0)
      ) order by s.name)
      from public.manager_team_shared_skills ss
      join public.skills s on s.id = ss.skill_id and s.user_id = m.member_user_id
      where ss.membership_id = m.id
    ), '[]'::jsonb),
    (select count(*) from public.manager_team_activity_participants ap where ap.membership_id = m.id)
  from public.manager_team_memberships m
  join public.profiles p on p.id = m.member_user_id
  where m.team_id = p_team_id and m.role = 'member' and m.status = 'active'
    and private.can_manage_manager_team(p_team_id, auth.uid())
  order by p.full_name nulls last, m.invited_at
$$;

create or replace function list_manager_team_learning_records(p_team_id uuid)
returns table (
  id uuid, title text, kind text, status text,
  member_ids uuid[], member_names text[], occurred_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select a.id, a.title,
    case when a.catalogue_course_id is null then 'session' else 'course' end,
    case a.status when 'active' then 'in_progress' else 'completed' end,
    coalesce(array_agg(m.id order by p.full_name) filter (where m.role = 'member'), '{}'),
    coalesce(array_agg(coalesce(nullif(trim(p.full_name), ''), 'Team member') order by p.full_name) filter (where m.role = 'member'), '{}'),
    coalesce(a.due_at, a.created_at)
  from public.manager_team_learning_activities a
  left join public.manager_team_activity_participants ap on ap.activity_id = a.id
  left join public.manager_team_memberships m on m.id = ap.membership_id
  left join public.profiles p on p.id = m.member_user_id
  where a.team_id = p_team_id and a.status <> 'cancelled'
    and private.can_manage_manager_team(p_team_id, auth.uid())
  group by a.id
  order by coalesce(a.due_at, a.created_at) desc
$$;

create or replace function list_manager_collaboration_records(p_team_id uuid)
returns table (
  id uuid, title text, note text, member_ids uuid[],
  member_names text[], created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.title, r.note,
    array_agg(m.id order by p.full_name),
    array_agg(coalesce(nullif(trim(p.full_name), ''), 'Team member') order by p.full_name),
    r.created_at
  from public.manager_collaboration_records r
  join public.manager_collaboration_record_members rm on rm.record_id = r.id
  join public.manager_team_memberships m on m.id = rm.membership_id
  join public.profiles p on p.id = m.member_user_id
  where r.team_id = p_team_id
    and private.can_manage_manager_team(p_team_id, auth.uid())
  group by r.id
  order by r.created_at desc
$$;

revoke all on function invite_connection_to_manager_team_by_email(uuid,text),
  create_manager_collaboration_record(uuid,text,text,uuid[]),
  list_manager_team_member_summaries(uuid),
  list_manager_team_learning_records(uuid),
  list_manager_collaboration_records(uuid)
from public, anon;

grant execute on function invite_connection_to_manager_team_by_email(uuid,text),
  create_manager_collaboration_record(uuid,text,text,uuid[]),
  list_manager_team_member_summaries(uuid),
  list_manager_team_learning_records(uuid),
  list_manager_collaboration_records(uuid)
to authenticated;
