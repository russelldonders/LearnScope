-- Coaching sessions (phase 3 of coaching on a skill, after 0335).
--
-- Either the learner or the coach proposes a session -- when, how long,
-- where or a video link, and what it's for -- and the other confirms or
-- declines it, or suggests another time (which replaces it with a new
-- proposal from them). Either can cancel. Once a confirmed session has
-- happened, the learner marks it done: the app records it as an activity
-- they did together with the coach on the learner's skill (the existing
-- joint activity, 0322, which also offers it to the coach for their own
-- record), and the session points at that activity. Nothing is recorded
-- without the learner doing it.
--
-- Not destructive: one new table and its functions. Rollback: drop them.

create table public.coaching_sessions (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.coaching_relationships(id) on delete cascade,
  proposed_by uuid not null references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  location text check (location is null or char_length(location) <= 500),
  agenda text check (agenda is null or char_length(agenda) <= 2000),
  status text not null default 'proposed'
    check (status in ('proposed', 'confirmed', 'declined', 'rescheduled', 'cancelled', 'done')),
  replaces_session_id uuid references public.coaching_sessions(id) on delete set null,
  responded_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  completed_at timestamptz,
  activity_statement_id uuid references public.xapi_statements(id) on delete set null,
  created_at timestamptz not null default now()
);

create index coaching_sessions_relationship_idx on public.coaching_sessions (relationship_id, starts_at);
create index coaching_sessions_created_idx on public.coaching_sessions (relationship_id, created_at);
-- One recorded activity stands for one session.
create unique index coaching_sessions_activity_idx on public.coaching_sessions (activity_statement_id)
  where activity_statement_id is not null;

alter table public.coaching_sessions enable row level security;

create policy "Learner and coach see their coaching sessions"
  on public.coaching_sessions for select
  to authenticated
  using (
    exists (
      select 1 from public.coaching_relationships r
      where r.id = coaching_sessions.relationship_id
        and (select auth.uid()) in (r.learner_id, r.coach_id)
    )
  );

-- Read-only for the two of them, and not which activity on the learner's
-- record a session became (list_my_coaching_sessions shows that to the
-- learner only). All changes go through the functions below.
revoke all on public.coaching_sessions from anon, authenticated;
grant select (
  id, relationship_id, proposed_by, starts_at, duration_minutes, location, agenda, status,
  replaces_session_id, responded_at, cancelled_by, cancelled_at, completed_at, created_at
) on public.coaching_sessions to authenticated;

-- The relationship, if the caller is in it.
create function private.my_coaching_relationship(p_relationship_id uuid)
returns public.coaching_relationships
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from public.coaching_relationships r
  where r.id = p_relationship_id and (select auth.uid()) in (r.learner_id, r.coach_id)
$$;

-- Checks shared by proposing and rescheduling. Sessions are planned from
-- now on (a session that already happened is logged as an activity), up to
-- a year ahead, and a relationship has at most 20 waiting at once.
create function private.check_coaching_session_plan(
  p_relationship public.coaching_relationships,
  p_starts_at timestamptz,
  p_duration_minutes integer
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_relationship.id is null then
    raise exception 'Coaching not found';
  end if;
  if p_relationship.status <> 'active' then
    raise exception 'Sessions can only be planned while coaching is going on';
  end if;
  if p_starts_at is null or p_starts_at < now() - interval '1 hour' or p_starts_at > now() + interval '1 year' then
    raise exception 'Choose a time from now up to a year ahead';
  end if;
  if p_duration_minutes is null or p_duration_minutes not between 5 and 480 then
    raise exception 'A session lasts between 5 minutes and 8 hours';
  end if;
  if (
    select count(*) from public.coaching_sessions
    where relationship_id = p_relationship.id and status in ('proposed', 'confirmed')
  ) >= 20 then
    raise exception 'There are already 20 sessions planned. Hold or cancel some first.';
  end if;
  -- However they end, no more than 10 new proposals a day, so neither
  -- person's notifications can be flooded.
  if (
    select count(*) from public.coaching_sessions
    where relationship_id = p_relationship.id and created_at > now() - interval '1 day'
  ) >= 10 then
    raise exception 'That''s a lot of sessions proposed today. Please try again tomorrow.';
  end if;
end;
$$;

create function public.propose_coaching_session(
  p_relationship_id uuid,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_location text default null,
  p_agenda text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_relationship public.coaching_relationships := private.my_coaching_relationship(p_relationship_id);
  v_id uuid;
begin
  perform private.check_coaching_session_plan(v_relationship, p_starts_at, p_duration_minutes);
  insert into public.coaching_sessions (relationship_id, proposed_by, starts_at, duration_minutes, location, agenda)
  values (v_relationship.id, (select auth.uid()), p_starts_at, p_duration_minutes,
    nullif(btrim(p_location), ''), nullif(btrim(p_agenda), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- The other person confirms or declines a proposed session.
create function public.respond_to_coaching_session(p_session_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.coaching_sessions%rowtype;
  v_relationship public.coaching_relationships;
begin
  select * into v_session from public.coaching_sessions where id = p_session_id for update;
  v_relationship := private.my_coaching_relationship(v_session.relationship_id);
  if v_session.id is null or v_relationship.id is null then
    raise exception 'Session not found';
  end if;
  if v_session.proposed_by = (select auth.uid()) then
    raise exception 'The other person answers a session you proposed';
  end if;
  if v_session.status <> 'proposed' then
    raise exception 'This session has already been answered';
  end if;
  if p_accept and v_relationship.status <> 'active' then
    raise exception 'Sessions can only be planned while coaching is going on';
  end if;
  update public.coaching_sessions
  set status = case when p_accept then 'confirmed' else 'declined' end, responded_at = now()
  where id = v_session.id;
end;
$$;

-- Either person suggests another time for a proposed or confirmed session:
-- it's replaced by a new proposal from them, for the other to answer.
create function public.reschedule_coaching_session(
  p_session_id uuid,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_location text default null,
  p_agenda text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.coaching_sessions%rowtype;
  v_relationship public.coaching_relationships;
  v_id uuid;
begin
  select * into v_session from public.coaching_sessions where id = p_session_id for update;
  v_relationship := private.my_coaching_relationship(v_session.relationship_id);
  if v_session.id is null or v_relationship.id is null then
    raise exception 'Session not found';
  end if;
  if v_session.status not in ('proposed', 'confirmed') then
    raise exception 'Only a planned session can be moved';
  end if;
  if v_session.status = 'confirmed' and v_session.starts_at <= now() then
    raise exception 'This session has already started';
  end if;
  update public.coaching_sessions set status = 'rescheduled', responded_at = now() where id = v_session.id;
  perform private.check_coaching_session_plan(v_relationship, p_starts_at, p_duration_minutes);
  insert into public.coaching_sessions (relationship_id, proposed_by, starts_at, duration_minutes, location, agenda, replaces_session_id)
  values (v_relationship.id, (select auth.uid()), p_starts_at, p_duration_minutes,
    nullif(btrim(p_location), ''), nullif(btrim(p_agenda), ''), v_session.id)
  returning id into v_id;
  return v_id;
end;
$$;

-- Either person calls off a planned session.
create function public.cancel_coaching_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.coaching_sessions s
  set status = 'cancelled', cancelled_by = (select auth.uid()), cancelled_at = now()
  where s.id = p_session_id
    and s.status in ('proposed', 'confirmed')
    and exists (
      select 1 from public.coaching_relationships r
      where r.id = s.relationship_id
        and (select auth.uid()) in (r.learner_id, r.coach_id)
        -- Once a confirmed session has started, only the learner can call it
        -- off (it didn't happen); the coach can't stop it being recorded.
        and (s.status = 'proposed' or s.starts_at > now() or r.learner_id = (select auth.uid()))
    );
  if not found then
    raise exception 'Session not found';
  end if;
end;
$$;

-- The learner marks a confirmed session that has started as done, with the
-- activity they just recorded for it: their own, done together with the
-- coach (p_statement_id). Even after coaching has ended, so a last session
-- can still be recorded.
create function public.complete_coaching_session(p_session_id uuid, p_statement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.coaching_sessions%rowtype;
  v_relationship public.coaching_relationships;
begin
  select * into v_session from public.coaching_sessions where id = p_session_id for update;
  v_relationship := private.my_coaching_relationship(v_session.relationship_id);
  if v_session.id is null or v_relationship.id is null or v_relationship.learner_id <> (select auth.uid()) then
    raise exception 'Session not found';
  end if;
  if v_session.status <> 'confirmed' then
    raise exception 'Only a confirmed session can be marked done';
  end if;
  if v_session.starts_at > now() then
    raise exception 'This session hasn''t started yet';
  end if;
  if not exists (
    select 1 from public.xapi_statements x
    where x.id = p_statement_id
      and x.user_id = v_relationship.learner_id
      and x.with_user_id = v_relationship.coach_id
      and x.with_kind = 'joint'
  ) then
    raise exception 'Record the session as something you did together with your coach';
  end if;
  update public.coaching_sessions
  set status = 'done', completed_at = now(), activity_statement_id = p_statement_id
  where id = v_session.id;
end;
$$;

-- The caller's sessions in all their coaching, as learner or coach.
create function public.list_my_coaching_sessions()
returns table (
  id uuid,
  relationship_id uuid,
  role text,
  proposed_by_me boolean,
  starts_at timestamptz,
  duration_minutes integer,
  location text,
  agenda text,
  status text,
  replaces_session_id uuid,
  responded_at timestamptz,
  cancelled_by_me boolean,
  cancelled_at timestamptz,
  completed_at timestamptz,
  activity_statement_id uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.relationship_id,
    case when r.learner_id = (select auth.uid()) then 'learner' else 'coach' end,
    s.proposed_by = (select auth.uid()),
    s.starts_at,
    s.duration_minutes,
    s.location,
    s.agenda,
    s.status,
    s.replaces_session_id,
    s.responded_at,
    s.cancelled_by = (select auth.uid()),
    s.cancelled_at,
    s.completed_at,
    -- Only the learner's own activity id; the coach has their own record.
    case when r.learner_id = (select auth.uid()) then s.activity_statement_id end,
    s.created_at
  from public.coaching_sessions s
  join public.coaching_relationships r on r.id = s.relationship_id
  where (select auth.uid()) in (r.learner_id, r.coach_id)
    -- Planned and done ones, and the rest from the last 90 days.
    and (s.status in ('proposed', 'confirmed', 'done') or coalesce(s.cancelled_at, s.responded_at, s.created_at) > now() - interval '90 days')
  order by s.starts_at
  limit 500
$$;

revoke all on function private.my_coaching_relationship(uuid) from public, anon, authenticated;
revoke all on function private.check_coaching_session_plan(public.coaching_relationships, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.propose_coaching_session(uuid, timestamptz, integer, text, text) from public, anon;
revoke all on function public.respond_to_coaching_session(uuid, boolean) from public, anon;
revoke all on function public.reschedule_coaching_session(uuid, timestamptz, integer, text, text) from public, anon;
revoke all on function public.cancel_coaching_session(uuid) from public, anon;
revoke all on function public.complete_coaching_session(uuid, uuid) from public, anon;
revoke all on function public.list_my_coaching_sessions() from public, anon;
grant execute on function public.propose_coaching_session(uuid, timestamptz, integer, text, text) to authenticated;
grant execute on function public.respond_to_coaching_session(uuid, boolean) to authenticated;
grant execute on function public.reschedule_coaching_session(uuid, timestamptz, integer, text, text) to authenticated;
grant execute on function public.cancel_coaching_session(uuid) to authenticated;
grant execute on function public.complete_coaching_session(uuid, uuid) to authenticated;
grant execute on function public.list_my_coaching_sessions() to authenticated;
