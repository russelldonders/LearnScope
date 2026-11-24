-- Coaching on a skill (phases 1 and 2).
--
-- A learner whose skill another person has validated can offer coaching on
-- it; anyone with the same library skill then finds them as a coach in
-- "Find an expert", and can ask them for coaching. A learner who finds no
-- coach can say they're looking for one, and hears when one becomes
-- available. A coach accepts or declines; accepting connects the two (as an
-- accepted connection request does). Either can end it later; the
-- relationship stays as history with when it started and ended.
--
-- Builds on what exists: the skill's own opt-ins to validate others (0041),
-- person-confirmed validation (skill_validation_requests.status =
-- 'confirmed'), list_skill_matches (0058) and upsert_connection (0058).
--
-- Not destructive: one new column pair on skills (default off), two new
-- tables, list_skill_matches recreated with extra columns (its only caller
-- is listSkillMatches), and skill_has_exclusive_dependents extended with
-- the new tables. Rollback: drop the new functions, tables, trigger and
-- columns, restore list_skill_matches from 0058 and
-- skill_has_exclusive_dependents from 20261107090000.

-- 1. Offering coaching on a skill ---------------------------------------------

alter table public.skills
  add column offer_coaching boolean not null default false,
  add column coaching_offered_at timestamptz;

-- Only on a skill another person has validated (validated or maintained,
-- with a confirmed validation request from someone who has the same library
-- skill themselves) and that's in the library, so others with the same skill
-- can find it. If the skill stops being verified -- or is pointed at a
-- different library skill, which the validation didn't cover -- it stops
-- offering. When it was first offered is kept by the server, not the client,
-- so "a coach is now available" can't be faked; switching it off and on again
-- within 30 days keeps the earlier time, so it can't be used to re-announce.
create function private.guard_skill_coaching_offer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_offered_at timestamptz := case when tg_op = 'UPDATE' then old.coaching_offered_at end;
begin
  -- Kept while off, for the 30-day rule below; never set by the client.
  new.coaching_offered_at := v_was_offered_at;

  if not new.offer_coaching then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.library_skill_id is distinct from old.library_skill_id then
    if old.offer_coaching then
      new.offer_coaching := false;
      return new;
    end if;
    raise exception 'You can offer coaching on a skill once another person has validated it'
      using errcode = 'check_violation';
  end if;

  if not (
    new.lifecycle_stage in ('validated', 'maintained')
    and new.library_skill_id is not null
    and exists (
      select 1
      from public.skill_validation_requests v
      join public.skills validator_skill
        on validator_skill.user_id = v.validator_id
       and validator_skill.library_skill_id = new.library_skill_id
      where v.skill_id = new.id and v.status = 'confirmed'
    )
  ) then
    if tg_op = 'UPDATE' and old.offer_coaching then
      new.offer_coaching := false;
      return new;
    end if;
    raise exception 'You can offer coaching on a skill once another person has validated it'
      using errcode = 'check_violation';
  end if;

  if not (tg_op = 'UPDATE' and old.offer_coaching)
     and (v_was_offered_at is null or v_was_offered_at < now() - interval '30 days') then
    new.coaching_offered_at := now();
  end if;
  return new;
end;
$$;

create trigger skills_guard_coaching_offer
  before insert or update of offer_coaching, coaching_offered_at, lifecycle_stage, library_skill_id on public.skills
  for each row execute function private.guard_skill_coaching_offer();

create index skills_coaching_idx on public.skills (library_skill_id) where offer_coaching;

-- 2. "Looking for a coach" -----------------------------------------------------

-- One per learner skill. Only ever the learner's own: nobody else sees who
-- is waiting for a coach.
create table public.coach_interests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (skill_id)
);

create index coach_interests_user_idx on public.coach_interests (user_id);

alter table public.coach_interests enable row level security;

create policy "Learners see their own coach interests"
  on public.coach_interests for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Learners register interest in a coach for their own library skill"
  on public.coach_interests for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.skills s
      where s.id = coach_interests.skill_id
        and s.user_id = (select auth.uid())
        and s.library_skill_id is not null
    )
  );

create policy "Learners withdraw their own coach interests"
  on public.coach_interests for delete
  to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.coach_interests to authenticated;

-- 3. Coaching relationships ----------------------------------------------------

-- Learner, coach and the skill, with when it was asked for, started and
-- ended. Read by the two people in it; changed only through the functions
-- below, which check who may do what. Kept as history for both of them even
-- if either deletes their skill (its name is kept on the row); only deleting
-- an account removes it.
create table public.coaching_relationships (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  coach_id uuid not null references auth.users(id) on delete cascade,
  learner_skill_id uuid references public.skills(id) on delete set null,
  coach_skill_id uuid references public.skills(id) on delete set null,
  library_skill_id uuid references public.skill_library(id) on delete set null,
  skill_name text not null,
  status text not null default 'requested'
    check (status in ('requested', 'active', 'declined', 'withdrawn', 'ended')),
  message text check (message is null or char_length(message) <= 1000),
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references auth.users(id) on delete set null,
  check (learner_id <> coach_id)
);

-- At most one open request or active coaching between a learner and a coach
-- in one library skill, however many of their own skills point at it.
create unique index coaching_relationships_open_idx
  on public.coaching_relationships (learner_id, coach_id, library_skill_id)
  where status in ('requested', 'active');
create index coaching_relationships_learner_idx on public.coaching_relationships (learner_id);
create index coaching_relationships_coach_idx on public.coaching_relationships (coach_id);

alter table public.coaching_relationships enable row level security;

create policy "Learner and coach see their coaching"
  on public.coaching_relationships for select
  to authenticated
  using ((select auth.uid()) in (learner_id, coach_id));

grant select on public.coaching_relationships to authenticated;

-- A learner asks a coach for coaching on their own skill.
create function public.request_coaching(p_learner_skill_id uuid, p_coach_skill_id uuid, p_message text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_mine public.skills%rowtype;
  v_theirs public.skills%rowtype;
  v_id uuid;
begin
  if v_caller is null then
    raise insufficient_privilege using message = 'Sign in to ask for coaching';
  end if;

  select * into v_mine from public.skills where id = p_learner_skill_id and user_id = v_caller;
  if not found or v_mine.library_skill_id is null then
    raise exception 'Choose one of your own skills to be coached in';
  end if;

  select * into v_theirs from public.skills where id = p_coach_skill_id;
  if not found or not v_theirs.offer_coaching or v_theirs.library_skill_id is distinct from v_mine.library_skill_id then
    raise exception 'This person isn''t offering coaching on this skill';
  end if;
  if v_theirs.user_id = v_caller then
    raise exception 'You can''t coach yourself';
  end if;

  if exists (
    select 1 from public.coaching_relationships
    where learner_id = v_caller and coach_id = v_theirs.user_id
      and library_skill_id = v_mine.library_skill_id and status in ('requested', 'active')
  ) then
    raise exception 'You''ve already asked this person to coach you in this skill';
  end if;

  -- A coach who said no isn't asked again for 30 days, and a request taken
  -- back can't be sent again the same day -- so nobody can be asked over and
  -- over. A learner has at most 10 requests waiting at once.
  if exists (
    select 1 from public.coaching_relationships
    where learner_id = v_caller and coach_id = v_theirs.user_id
      and library_skill_id = v_mine.library_skill_id
      and (
        (status = 'declined' and responded_at > now() - interval '30 days')
        or (status = 'withdrawn' and responded_at > now() - interval '1 day')
      )
  ) then
    raise exception 'You asked this person recently. Please wait before asking them again.';
  end if;
  if (select count(*) from public.coaching_relationships where learner_id = v_caller and status = 'requested') >= 10 then
    raise exception 'You have too many coaching requests waiting. Wait for some answers first.';
  end if;

  insert into public.coaching_relationships (learner_id, coach_id, learner_skill_id, coach_skill_id, library_skill_id, skill_name, message)
  values (
    v_caller, v_theirs.user_id, v_mine.id, v_theirs.id, v_mine.library_skill_id,
    coalesce((select sl.name from public.skill_library sl where sl.id = v_mine.library_skill_id), v_mine.name),
    nullif(btrim(p_message), '')
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- The coach accepts or declines. Accepting connects them and ends the
-- learner's search for a coach on that skill.
create function public.respond_to_coaching_request(p_relationship_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_row public.coaching_relationships%rowtype;
begin
  select * into v_row from public.coaching_relationships where id = p_relationship_id for update;
  if not found or v_row.coach_id is distinct from v_caller then
    raise exception 'Coaching request not found';
  end if;
  if v_row.status <> 'requested' then
    raise exception 'This request has already been answered';
  end if;

  if p_accept then
    -- Only while they still offer coaching on that skill (still verified).
    if not exists (
      select 1 from public.skills s
      where s.id = v_row.coach_skill_id and s.user_id = v_caller and s.offer_coaching
    ) then
      raise exception 'You''re no longer offering coaching on this skill';
    end if;
    update public.coaching_relationships
    set status = 'active', responded_at = now(), started_at = now()
    where id = v_row.id;
    perform public.upsert_connection(v_row.learner_id, v_row.coach_id, 'request');
    delete from public.coach_interests where skill_id = v_row.learner_skill_id;
  else
    update public.coaching_relationships
    set status = 'declined', responded_at = now()
    where id = v_row.id;
  end if;
end;
$$;

-- The learner takes back a request not yet answered.
create function public.withdraw_coaching_request(p_relationship_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.coaching_relationships
  set status = 'withdrawn', responded_at = now()
  where id = p_relationship_id
    and learner_id = (select auth.uid())
    and status = 'requested';
  if not found then
    raise exception 'Coaching request not found';
  end if;
end;
$$;

-- Either of them ends coaching. It stays as history.
create function public.end_coaching(p_relationship_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.coaching_relationships
  set status = 'ended', ended_at = now(), ended_by = (select auth.uid())
  where id = p_relationship_id
    and (select auth.uid()) in (learner_id, coach_id)
    and status = 'active';
  if not found then
    raise exception 'Coaching not found';
  end if;
end;
$$;

-- The caller's coaching, both as learner and as coach, with the other
-- person's name and picture and the skill's library name.
create function public.list_my_coaching()
returns table (
  id uuid,
  role text,
  status text,
  other_user_id uuid,
  other_name text,
  other_avatar_url text,
  learner_skill_id uuid,
  coach_skill_id uuid,
  library_skill_id uuid,
  skill_name text,
  message text,
  requested_at timestamptz,
  responded_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  ended_by_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id,
    case when r.learner_id = (select auth.uid()) then 'learner' else 'coach' end,
    r.status,
    other.id,
    coalesce(nullif(btrim(other.full_name), ''), 'A LearnScope learner'),
    other.avatar_url,
    r.learner_skill_id,
    r.coach_skill_id,
    r.library_skill_id,
    r.skill_name,
    r.message,
    r.requested_at,
    r.responded_at,
    r.started_at,
    r.ended_at,
    r.ended_by = (select auth.uid())
  from public.coaching_relationships r
  join public.profiles other
    on other.id = case when r.learner_id = (select auth.uid()) then r.coach_id else r.learner_id end
  where (select auth.uid()) in (r.learner_id, r.coach_id)
  order by r.requested_at desc
$$;

-- How many others offer coaching on a library skill (for "Looking for a
-- coach" when there are none).
create function public.count_skill_coaches(p_library_skill_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.skills s
  where s.library_skill_id = p_library_skill_id
    and s.offer_coaching
    and s.user_id <> (select auth.uid())
$$;

-- The caller's own "looking for a coach" interests, each with when a coach
-- first became available after they registered it (null while none has).
create function public.list_my_coach_interests()
returns table (
  id uuid,
  skill_id uuid,
  skill_name text,
  created_at timestamptz,
  coach_available_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ci.id,
    ci.skill_id,
    s.name,
    ci.created_at,
    (
      select min(c.coaching_offered_at)
      from public.skills c
      where c.library_skill_id = s.library_skill_id
        and c.offer_coaching
        and c.user_id <> ci.user_id
        and c.coaching_offered_at >= ci.created_at
    )
  from public.coach_interests ci
  join public.skills s on s.id = ci.skill_id
  where ci.user_id = (select auth.uid())
  order by ci.created_at desc
$$;

revoke all on function public.request_coaching(uuid, uuid, text) from public, anon;
revoke all on function public.respond_to_coaching_request(uuid, boolean) from public, anon;
revoke all on function public.withdraw_coaching_request(uuid) from public, anon;
revoke all on function public.end_coaching(uuid) from public, anon;
revoke all on function public.list_my_coaching() from public, anon;
revoke all on function public.count_skill_coaches(uuid) from public, anon;
revoke all on function public.list_my_coach_interests() from public, anon;
grant execute on function public.request_coaching(uuid, uuid, text) to authenticated;
grant execute on function public.respond_to_coaching_request(uuid, boolean) to authenticated;
grant execute on function public.withdraw_coaching_request(uuid) to authenticated;
grant execute on function public.end_coaching(uuid) to authenticated;
grant execute on function public.list_my_coaching() to authenticated;
grant execute on function public.count_skill_coaches(uuid) to authenticated;
grant execute on function public.list_my_coach_interests() to authenticated;

-- 4. Coaches in "Find an expert" -----------------------------------------------

-- As 0058, plus whether each person offers coaching on the skill (with the
-- skill to ask them about) and whether the caller has already asked them.
-- Offering coaching is itself consent to be found for that skill, so a
-- coach is listed even when they don't otherwise appear in skill search.
-- The return shape changes, which create-or-replace can't do.
drop function public.list_skill_matches(uuid);

create function public.list_skill_matches(p_library_skill_id uuid)
returns table (
  user_id uuid,
  full_name text,
  avatar_url text,
  level int,
  lifecycle_stage text,
  is_connection boolean,
  profile_viewable boolean,
  has_pending_request boolean,
  is_coach boolean,
  coach_skill_id uuid,
  my_coaching_status text
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    s.user_id,
    p.full_name,
    p.avatar_url,
    s.level,
    s.lifecycle_stage,
    public.is_connected(auth.uid(), s.user_id) as is_connection,
    (p.profile_visible_to_skill_matches or public.is_connected(auth.uid(), s.user_id)) as profile_viewable,
    exists (
      select 1 from public.connection_requests cr
      where cr.status = 'pending'
        and ((cr.requester_id = auth.uid() and cr.recipient_id = s.user_id)
          or (cr.requester_id = s.user_id and cr.recipient_id = auth.uid()))
    ) as has_pending_request,
    s.offer_coaching as is_coach,
    case when s.offer_coaching then s.id end as coach_skill_id,
    (
      select r.status from public.coaching_relationships r
      where r.learner_id = auth.uid() and r.coach_id = s.user_id
        and r.library_skill_id = p_library_skill_id
        and r.status in ('requested', 'active')
      order by r.requested_at desc
      limit 1
    ) as my_coaching_status
  from public.skills s
  join public.profiles p on p.id = s.user_id
  where s.library_skill_id = p_library_skill_id
    and s.user_id <> auth.uid()
    and (
      s.offer_coaching
      or p.skill_search_visibility = 'all'
      or (
        p.skill_search_visibility = 'selective'
        and exists (
          select 1 from public.profile_searchable_skills pss
          where pss.profile_id = s.user_id and pss.skill_id = s.id
        )
      )
    )
  order by p.full_name nulls last;
$$;

revoke all on function public.list_skill_matches(uuid) from public, anon;
grant execute on function public.list_skill_matches(uuid) to authenticated;

-- 5. Moving a skill between linked accounts ------------------------------------

-- A skill with coaching (as learner or coach) or a search for a coach stays
-- with its account, like one with goals or validation requests. As in
-- 20261107090000_skill_goals.sql, plus the two coaching tables.
create or replace function private.skill_has_exclusive_dependents(p_skill_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.skill_assessments where skill_id = p_skill_id)
    or exists (select 1 from public.skill_baseline_quizzes where skill_id = p_skill_id)
    or exists (select 1 from public.skill_tags where skill_id = p_skill_id)
    or exists (select 1 from public.skill_targets where skill_id = p_skill_id)
    or exists (select 1 from public.skill_course_links where skill_id = p_skill_id)
    or exists (select 1 from public.skill_experience_links where skill_id = p_skill_id)
    or exists (select 1 from public.xapi_statement_skills where skill_id = p_skill_id)
    or exists (select 1 from public.skill_peer_ratings where skill_id = p_skill_id)
    or exists (select 1 from public.skill_validation_requests where skill_id = p_skill_id)
    or exists (select 1 from public.manager_team_shared_skills where skill_id = p_skill_id)
    or exists (select 1 from public.employer_data_access_shared_skills where skill_id = p_skill_id)
    or exists (select 1 from public.connection_invites where skill_id = p_skill_id)
    or exists (select 1 from public.profile_share_link_skills where skill_id = p_skill_id)
    or exists (select 1 from public.skill_goals where skill_id = p_skill_id)
    or exists (select 1 from public.coaching_relationships where learner_skill_id = p_skill_id or coach_skill_id = p_skill_id)
    or exists (select 1 from public.coach_interests where skill_id = p_skill_id)
$$;
