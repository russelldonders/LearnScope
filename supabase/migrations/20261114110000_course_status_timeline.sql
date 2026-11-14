-- Every status change of a course on the connections feed, at its own time.
--
-- Until now the feed had one course event, "started", dated by when the
-- course record was created -- so a course planned in March and enrolled on
-- in June showed as started in March, and completing or cancelling a course
-- never showed at all. A course now records when it was planned and when it
-- was enrolled on (alongside cancelled_at and completed_date), and the feed
-- shows each: planned, started, completed, cancelled.
--
--   planned_at  -- set when a course is added to the learning plan
--   enrolled_at -- set when the learner enrols, including from a plan or
--                  again after cancelling
-- Both are filled in by the database (set_course_status_times), so every
-- way of enrolling -- the catalogue, a cohort, an assignment -- records it.
-- A course added as already completed (e.g. imported from a CV) gets no
-- enrolled_at: it wasn't started in LearnScope, so it isn't reported as
-- started now.
--
-- Existing rows: enrolled_at is backfilled from created_at for enrolments
-- (status null) that are either not yet completed or came from the
-- catalogue -- the same moment the feed already showed as "started" -- and
-- planned_at from created_at for planned rows. Completed and cancelled
-- courses now also appear on connections' feeds at their dates; old
-- completions sit with their (past) dates, so they don't jump to the top.
--
-- Also: a course provider's admins now see cancellations of their courses
-- too (not plans), so their participant list can show who withdrew.
--
-- Rollback: drop the trigger and function, the two columns, re-run the
-- previous list_connections_activity (20261114090000) and the previous
-- provider policy (20261114100000).

alter table public.courses
  add column planned_at timestamptz,
  add column enrolled_at timestamptz;

update public.courses set enrolled_at = created_at
where status is null and (completed_date is null or catalogue_course_id is not null);
update public.courses set planned_at = created_at where status = 'planned';
update public.courses set enrolled_at = created_at where status = 'cancelled' and enrolled_at is null;

create or replace function public.set_course_status_times()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.status = 'planned' then
      new.planned_at := coalesce(new.planned_at, now());
    elsif new.status is null and new.completed_date is null then
      new.enrolled_at := coalesce(new.enrolled_at, now());
    end if;
  elsif old.status is not null and new.status is null then
    -- Enrolling from a plan, or again after cancelling.
    new.enrolled_at := now();
  end if;
  return new;
end;
$function$;

create trigger set_course_status_times_trigger
  before insert or update on public.courses
  for each row execute function public.set_course_status_times();

CREATE OR REPLACE FUNCTION public.list_connections_activity(p_limit integer DEFAULT 30)
 RETURNS TABLE(event_type text, actor_id uuid, full_name text, avatar_url text, event_at timestamp with time zone, skill_name text, level integer, detail text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from (
    -- Skill level confirmed: via quiz or AI assessment.
    select
      'skill_confirmed' as event_type,
      sa.user_id as actor_id,
      p.full_name,
      p.avatar_url,
      sa.created_at as event_at,
      s.name as skill_name,
      sa.level,
      (case sa.source
        when 'diagnostic_confirmed' then 'Confirmed via knowledge check'
        when 'ai_baseline' then 'AI-assessed baseline'
        when 'ai_evaluation' then 'AI assessment'
        else null
      end)::text as detail
    from skill_assessments sa
    join skills s on s.id = sa.skill_id
    join profiles p on p.id = sa.user_id
    where sa.source in ('diagnostic_confirmed', 'ai_baseline', 'ai_evaluation')
      and sa.user_id <> auth.uid()
      and is_connected(auth.uid(), sa.user_id)
      and p.activity_feed_visible = true

    union all

    -- Skill formally validated by another connection.
    select
      'skill_validated',
      svr.requester_id,
      p.full_name,
      p.avatar_url,
      svr.decided_at,
      s.name,
      svr.target_level,
      'Validated by a connection'::text
    from skill_validation_requests svr
    join skills s on s.id = svr.skill_id
    join profiles p on p.id = svr.requester_id
    where svr.status = 'confirmed'
      and svr.requester_id <> auth.uid()
      and is_connected(auth.uid(), svr.requester_id)
      and p.activity_feed_visible = true

    union all

    -- New skill added.
    select
      'skill_added',
      s.user_id,
      p.full_name,
      p.avatar_url,
      s.date_added,
      s.name,
      null::int,
      null::text
    from skills s
    join profiles p on p.id = s.user_id
    where s.user_id <> auth.uid()
      and is_connected(auth.uid(), s.user_id)
      and p.activity_feed_visible = true

    union all

    -- New experience added.
    select
      'experience_added',
      e.user_id,
      p.full_name,
      p.avatar_url,
      e.created_at,
      null::text,
      null::int,
      (e.type || ' at ' || e.organization || ': ' || e.title)::text
    from experience e
    join profiles p on p.id = e.user_id
    where e.user_id <> auth.uid()
      and is_connected(auth.uid(), e.user_id)
      and p.activity_feed_visible = true

    union all

    -- A course's status changes, each at the time it happened: planned,
    -- started (enrolled), completed and cancelled.
    select
      e.event_type,
      c.user_id,
      p.full_name,
      p.avatar_url,
      e.event_at,
      null::text,
      null::int,
      (c.name || coalesce(' · ' || c.provider, ''))::text
    from courses c
    join profiles p on p.id = c.user_id
    cross join lateral (values
      ('course_planned'::text, c.planned_at),
      ('course_started'::text, c.enrolled_at),
      ('course_completed'::text, c.completed_date::timestamptz),
      ('course_cancelled'::text, c.cancelled_at)
    ) as e(event_type, event_at)
    where e.event_at is not null
      and c.user_id <> auth.uid()
      and is_connected(auth.uid(), c.user_id)
      and p.activity_feed_visible = true

    union all

    -- Target set for a skill.
    select
      'target_set',
      st.user_id,
      p.full_name,
      p.avatar_url,
      st.created_at,
      s.name,
      st.target_level,
      null::text
    from skill_targets st
    join skills s on s.id = st.skill_id
    join profiles p on p.id = st.user_id
    where st.user_id <> auth.uid()
      and is_connected(auth.uid(), st.user_id)
      and p.activity_feed_visible = true
  ) events
  order by event_at desc
  limit p_limit
$function$
;

CREATE OR REPLACE FUNCTION public.list_connections_activity(p_limit integer DEFAULT 30, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(event_type text, actor_id uuid, full_name text, avatar_url text, event_at timestamp with time zone, skill_name text, level integer, detail text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from (
    select
      'skill_confirmed' as event_type,
      sa.user_id as actor_id,
      p.full_name,
      p.avatar_url,
      sa.created_at as event_at,
      s.name as skill_name,
      sa.level,
      (case sa.source
        when 'diagnostic_confirmed' then 'Confirmed via knowledge check'
        when 'ai_baseline' then 'AI-assessed baseline'
        when 'ai_evaluation' then 'AI assessment'
        else null
      end)::text as detail
    from skill_assessments sa
    join skills s on s.id = sa.skill_id
    join profiles p on p.id = sa.user_id
    where sa.source in ('diagnostic_confirmed', 'ai_baseline', 'ai_evaluation')
      and sa.user_id <> auth.uid()
      and (p_user_id is null or sa.user_id = p_user_id)
      and is_connected(auth.uid(), sa.user_id)
      and p.activity_feed_visible = true

    union all

    select
      'skill_validated',
      svr.requester_id,
      p.full_name,
      p.avatar_url,
      svr.decided_at,
      s.name,
      svr.target_level,
      'Validated by a connection'::text
    from skill_validation_requests svr
    join skills s on s.id = svr.skill_id
    join profiles p on p.id = svr.requester_id
    where svr.status = 'confirmed'
      and svr.requester_id <> auth.uid()
      and (p_user_id is null or svr.requester_id = p_user_id)
      and is_connected(auth.uid(), svr.requester_id)
      and p.activity_feed_visible = true

    union all

    select
      'skill_added',
      s.user_id,
      p.full_name,
      p.avatar_url,
      s.date_added,
      s.name,
      null::int,
      null::text
    from skills s
    join profiles p on p.id = s.user_id
    where s.user_id <> auth.uid()
      and (p_user_id is null or s.user_id = p_user_id)
      and is_connected(auth.uid(), s.user_id)
      and p.activity_feed_visible = true

    union all

    select
      'experience_added',
      e.user_id,
      p.full_name,
      p.avatar_url,
      e.created_at,
      null::text,
      null::int,
      (e.type || ' at ' || e.organization || ': ' || e.title)::text
    from experience e
    join profiles p on p.id = e.user_id
    where e.user_id <> auth.uid()
      and (p_user_id is null or e.user_id = p_user_id)
      and is_connected(auth.uid(), e.user_id)
      and p.activity_feed_visible = true

    union all

    -- A course's status changes, each at the time it happened: planned,
    -- started (enrolled), completed and cancelled.
    select
      e.event_type,
      c.user_id,
      p.full_name,
      p.avatar_url,
      e.event_at,
      null::text,
      null::int,
      (c.name || coalesce(' · ' || c.provider, ''))::text
    from courses c
    join profiles p on p.id = c.user_id
    cross join lateral (values
      ('course_planned'::text, c.planned_at),
      ('course_started'::text, c.enrolled_at),
      ('course_completed'::text, c.completed_date::timestamptz),
      ('course_cancelled'::text, c.cancelled_at)
    ) as e(event_type, event_at)
    where e.event_at is not null
      and c.user_id <> auth.uid()
      and (p_user_id is null or c.user_id = p_user_id)
      and is_connected(auth.uid(), c.user_id)
      and p.activity_feed_visible = true

    union all

    select
      'target_set',
      st.user_id,
      p.full_name,
      p.avatar_url,
      st.created_at,
      s.name,
      st.target_level,
      null::text
    from skill_targets st
    join skills s on s.id = st.skill_id
    join profiles p on p.id = st.user_id
    where st.user_id <> auth.uid()
      and (p_user_id is null or st.user_id = p_user_id)
      and is_connected(auth.uid(), st.user_id)
      and p.activity_feed_visible = true
  ) events
  order by event_at desc
  limit p_limit
$function$;

drop policy "Provider admins can view their course participants" on public.courses;
create policy "Provider admins can view their course participants"
  on public.courses for select to authenticated
  using (
    catalogue_course_id is not null
    and is_course_provider_admin(catalogue_course_id, (select auth.uid()))
    and status is distinct from 'planned'
  );
