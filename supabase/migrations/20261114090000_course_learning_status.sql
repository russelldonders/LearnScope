-- Planned and cancelled learning.
--
-- A learner's course record ("courses") was only ever enrolled or, with a
-- completed_date, completed. This adds where it stands otherwise:
--   status null        -- enrolled (as every existing row is; nothing changes)
--   status 'planned'   -- on the learner's learning plan, not yet enrolled
--   status 'cancelled' -- enrolled, then withdrawn; kept, not deleted, with
--                         when it was cancelled
-- Completion still comes from completed_date. In progress is still worked
-- out from lesson progress, not stored.
--
-- Everything that treats a course record as an enrolment now looks at real
-- enrolments only: the connections feed (a plan is private, never announced
-- as "started a course"), a skill's pending-training count, participant and
-- cohort seat counts (a cancellation frees its seat), and cohort enrolment,
-- which turns a planned or cancelled record into the enrolment instead of
-- adding a second record for the same course.
--
-- No data changes: existing rows get status null, which reads exactly as
-- before. Rollback: drop the two columns and re-run the previous definitions
-- of the five functions (20261110090000 and earlier).

alter table public.courses
  add column status text,
  add column cancelled_at timestamptz,
  add constraint courses_status_check check (status in ('planned', 'cancelled')),
  add constraint courses_cancelled_at_check check ((status = 'cancelled') = (cancelled_at is not null));

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

    -- Course started (enrolled, not yet completed -- see 0035/Dashboard.jsx
    -- for why "in progress" is just completed_date is null, not a flag).
    select
      'course_started',
      c.user_id,
      p.full_name,
      p.avatar_url,
      c.created_at,
      null::text,
      null::int,
      (c.name || coalesce(' · ' || c.provider, ''))::text
    from courses c
    join profiles p on p.id = c.user_id
    where c.completed_date is null
      and c.status is null
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

    select
      'course_started',
      c.user_id,
      p.full_name,
      p.avatar_url,
      c.created_at,
      null::text,
      null::int,
      (c.name || coalesce(' · ' || c.provider, ''))::text
    from courses c
    join profiles p on p.id = c.user_id
    where c.completed_date is null
      and c.status is null
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

CREATE OR REPLACE FUNCTION public.get_my_skill_progress_counts()
 RETURNS TABLE(skill_id uuid, self_practical_count integer, self_knowledge_count integer, peer_rating_count integer, rate_invite_count integer, activity_count integer, has_target boolean, has_pending_validation boolean, has_pending_course boolean, has_completed_course boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with my_skills as (
    select s.id from public.skills s where s.user_id = (select auth.uid())
  ),
  self_assessments as (
    select a.skill_id,
      count(*) filter (where a.axis is distinct from 'knowledge')::int as practical,
      count(*) filter (where a.axis = 'knowledge')::int as knowledge
    from public.skill_assessments a
    join my_skills m on m.id = a.skill_id
    where a.source = 'self' or a.source is null
    group by a.skill_id
  ),
  ratings as (
    select r.skill_id, count(*)::int as n
    from public.skill_peer_ratings r join my_skills m on m.id = r.skill_id
    group by r.skill_id
  ),
  invites as (
    select i.skill_id, count(*)::int as n
    from public.connection_invites i join my_skills m on m.id = i.skill_id
    where i.invite_type = 'rate'
    group by i.skill_id
  ),
  -- Through xapi_statement_skills so an activity counts for every skill it
  -- relates to; the Confirming Baseline quiz's own statement is knowledge
  -- evidence, not practical activity, so it's left out.
  activities as (
    select l.skill_id, count(*)::int as n
    from public.xapi_statement_skills l
    join my_skills m on m.id = l.skill_id
    join public.xapi_statements x on x.id = l.statement_id
    where l.user_id = (select auth.uid())
      and not coalesce(x.statement -> 'result' -> 'extensions' ? 'https://learnscope.app/xapi/extensions/diagnostic', false)
    group by l.skill_id
  ),
  courses as (
    select cl.skill_id,
      bool_or(c.completed_date is null and c.status is null) as pending,
      bool_or(c.completed_date is not null and c.status is distinct from 'cancelled') as completed
    from public.skill_course_links cl
    join my_skills m on m.id = cl.skill_id
    join public.courses c on c.id = cl.course_id
    group by cl.skill_id
  )
  select m.id,
    coalesce(sa.practical, 0),
    coalesce(sa.knowledge, 0),
    coalesce(r.n, 0),
    coalesce(i.n, 0),
    coalesce(ac.n, 0),
    exists (select 1 from public.skill_targets t where t.skill_id = m.id),
    exists (select 1 from public.skill_validation_requests v where v.skill_id = m.id and v.status = 'pending'),
    coalesce(co.pending, false),
    coalesce(co.completed, false)
  from my_skills m
  left join self_assessments sa on sa.skill_id = m.id
  left join ratings r on r.skill_id = m.id
  left join invites i on i.skill_id = m.id
  left join activities ac on ac.skill_id = m.id
  left join courses co on co.skill_id = m.id
$function$;

CREATE OR REPLACE FUNCTION public.count_course_participants_bulk(p_catalogue_course_ids uuid[])
 RETURNS TABLE(catalogue_course_id uuid, participant_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.catalogue_course_id, count(distinct c.user_id) as participant_count
  from courses c
  where c.catalogue_course_id = any (p_catalogue_course_ids)
    and c.status is null
    and is_platform_admin((select auth.uid()))
  group by c.catalogue_course_id
$function$;

CREATE OR REPLACE FUNCTION public.get_cohort_seat_counts(p_cohort_ids uuid[])
 RETURNS TABLE(cohort_id uuid, enrolled_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.cohort_id, count(*) as enrolled_count
  from courses c
  where c.cohort_id = any (p_cohort_ids)
    and c.status is distinct from 'cancelled'
    and exists (
      select 1 from course_cohorts cch
      join course_catalogue cc on cc.id = cch.course_catalogue_id
      where cch.id = c.cohort_id
        and (
          (cc.status = 'approved' and cc.is_current_published and is_course_published_to_catalogue(cc.id))
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c2 where c2.catalogue_course_id = cc.id and c2.user_id = auth.uid())
        )
    )
  group by c.cohort_id
$function$;

CREATE OR REPLACE FUNCTION public.enrol_in_course_cohort(p_cohort_id uuid, p_skill_id uuid DEFAULT NULL::uuid)
 RETURNS courses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := (select auth.uid());
  v_cohort course_cohorts%rowtype;
  v_course course_catalogue%rowtype;
  v_existing_count int;
  v_course_row courses%rowtype;
  v_planned_id uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_cohort from course_cohorts where id = p_cohort_id for update;
  if not found then
    raise exception 'Cohort not found';
  end if;

  if not v_cohort.enrolment_open then
    raise exception 'Enrolment for this cohort is closed';
  end if;

  -- Still holding the row lock above, so a concurrent enrolment on this
  -- same cohort can't slip in between this count and the insert below.
  select count(*) into v_existing_count from courses
  where cohort_id = p_cohort_id and status is distinct from 'cancelled';
  if v_cohort.capacity is not null and v_existing_count >= v_cohort.capacity then
    raise exception 'This cohort is full';
  end if;

  select * into v_course from course_catalogue where id = v_cohort.course_catalogue_id;
  if not found then
    raise exception 'Course not found';
  end if;

  if p_skill_id is not null and not exists (
    select 1 from skills where id = p_skill_id and user_id = v_caller
  ) then
    raise exception 'Skill not found or not owned by the caller';
  end if;

  -- Transaction-local: cleared automatically once this call's transaction
  -- ends, so it can never carry over to a later, unrelated request.
  perform set_config('app.enrolling_via_rpc', 'true', true);

  -- A course the caller planned (or cancelled) becomes this enrolment
  -- rather than a second record of the same course: same row, so its skill
  -- links and history carry on.
  select id into v_planned_id from courses
  where user_id = v_caller and catalogue_course_id = v_course.id and status in ('planned', 'cancelled')
  order by created_at desc
  limit 1;

  if v_planned_id is not null then
    update courses
    set status = null, cancelled_at = null, cohort_id = v_cohort.id
    where id = v_planned_id
    returning * into v_course_row;
  else
    insert into courses (user_id, name, provider, course_type, duration, catalogue_course_id, cohort_id)
    values (v_caller, v_course.name, v_course.provider, v_course.course_type, v_course.duration, v_course.id, v_cohort.id)
    returning * into v_course_row;
  end if;

  if p_skill_id is not null and not exists (
    select 1 from skill_course_links where course_id = v_course_row.id and skill_id = p_skill_id
  ) then
    insert into skill_course_links (user_id, skill_id, course_id, relationship)
    values (v_caller, p_skill_id, v_course_row.id, 'developed');
  end if;

  return v_course_row;
end;
$function$;
