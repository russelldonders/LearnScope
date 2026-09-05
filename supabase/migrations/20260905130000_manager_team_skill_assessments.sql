-- Lets a manager record their own rating (and evidence) of a skill a team
-- member has shared with them. Deliberately a new, separate record rather
-- than writing into the learner's own skill_assessments -- that table stays
-- exclusively self-authored (RLS-locked to auth.uid() = user_id) and its
-- history must never be silently rewritten by anyone else. A manager's
-- assessment is always attributed to the manager who made it, lives
-- alongside the learner's own record without ever overwriting it, and is
-- visible only within this team relationship -- it isn't a form of
-- verification exposed anywhere else in the product yet.
--
-- Consent: sharing a skill with a manager (manager_team_shared_skills)
-- already covers this. The same explicit, per-skill choice that lets a
-- manager see a skill is what lets that manager also rate it here -- no
-- separate opt-in.

create table manager_team_skill_assessments (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references manager_team_memberships(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  level int not null check (level between 1 and 5),
  comments text,
  evidence_url text,
  evidence_paths text[],
  assessed_by uuid not null references auth.users(id) on delete restrict,
  assessed_at timestamptz not null default now()
);

create index manager_team_skill_assessments_membership_idx
  on manager_team_skill_assessments (membership_id, skill_id, assessed_at desc);

alter table manager_team_skill_assessments enable row level security;

create policy "Member and managing manager can view manager team skill assessments"
  on manager_team_skill_assessments for select to authenticated using (
    exists (
      select 1 from manager_team_memberships m
      where m.id = membership_id
        and (m.member_user_id = (select auth.uid()) or private.can_manage_manager_team(m.team_id, (select auth.uid())))
    )
  );

create or replace function create_manager_team_skill_assessment(
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

create or replace function set_manager_team_skill_assessment_evidence(p_assessment_id uuid, p_evidence_paths text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.manager_team_skill_assessments
  set evidence_paths = p_evidence_paths
  where id = p_assessment_id and assessed_by = auth.uid();
  if not found then raise exception 'Assessment not found'; end if;
end
$$;

create or replace function list_manager_team_skill_assessments(p_membership_id uuid)
returns table (
  id uuid, skill_id uuid, level int, comments text, evidence_url text, evidence_paths text[],
  assessed_by_name text, assessed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.skill_id, a.level, a.comments, a.evidence_url, a.evidence_paths,
    coalesce(nullif(trim(p.full_name), ''), 'Manager'), a.assessed_at
  from public.manager_team_skill_assessments a
  join public.manager_team_memberships m on m.id = a.membership_id
  join public.profiles p on p.id = a.assessed_by
  where a.membership_id = p_membership_id
    and (m.member_user_id = auth.uid() or private.can_manage_manager_team(m.team_id, auth.uid()))
  order by a.assessed_at desc
$$;

-- Extends the manager-only member roster with each member's latest rating
-- (per shared skill) from the calling manager -- a read-your-own-writes
-- convenience for the console table so it doesn't need a second round trip
-- per row. Everything else about this projection is unchanged.
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
        ), 0),
        'managerRating', (
          select jsonb_build_object('level', ma.level, 'assessedAt', ma.assessed_at)
          from public.manager_team_skill_assessments ma
          where ma.membership_id = m.id and ma.skill_id = s.id and ma.assessed_by = auth.uid()
          order by ma.assessed_at desc limit 1
        )
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

revoke all on function create_manager_team_skill_assessment(uuid,uuid,int,text,text),
  set_manager_team_skill_assessment_evidence(uuid,text[]),
  list_manager_team_skill_assessments(uuid)
from public, anon;
grant execute on function create_manager_team_skill_assessment(uuid,uuid,int,text,text),
  set_manager_team_skill_assessment_evidence(uuid,text[]),
  list_manager_team_skill_assessments(uuid)
to authenticated;

grant select on manager_team_skill_assessments to authenticated;
