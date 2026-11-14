-- Plans stay private: the connections feed no longer shows a course being
-- planned (added in 20261114110000). Starting, completing and cancelling a
-- course still appear, each at its own time. planned_at is still recorded
-- for the learner's own use.
--
-- Rollback: re-run list_connections_activity from 20261114110000.

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

    -- A course's status changes, each at the time it happened: started
    -- (enrolled), completed and cancelled. Not planning: a plan is private.
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

    -- A course's status changes, each at the time it happened: started
    -- (enrolled), completed and cancelled. Not planning: a plan is private.
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
