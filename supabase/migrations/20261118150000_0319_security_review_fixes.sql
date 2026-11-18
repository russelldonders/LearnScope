-- 0319: security fixes from the whole-app review (2026-11-18).
--
-- 1. Organisation and employer membership: an admin could insert a member
--    row straight through the API (status 'active', any user id) or rewrite
--    one (user_id, pending -> active), skipping the invitee's consent. No
--    client code writes these tables; invites, decisions and status changes
--    all go through the service-role API or security-definer functions,
--    which these policies never applied to. So the write policies are
--    dropped rather than patched. Delete policies (removing a member) stay.
--
-- 2. Connections' activity feed and a connection's recent growth showed
--    skills the learner had hidden from their profile (or with their whole
--    skills profile hidden from connections). Each skill-based part now
--    applies the same test as "Connections can view visible skills
--    profiles" on skills. Experience and course events are unchanged.
--
-- 3. get_validation_request_contact returned a validator's email address to
--    anyone who created a request naming them -- and anyone can create one,
--    so it handed out the email of every validator. The validation request
--    email is now addressed on the server (api/send-email.js looks the
--    validator up itself), so the function is no longer callable by users.
--
-- Not destructive: no data changes. Rollback: re-create the three policies
-- from 0065_platform_roles_and_organisations.sql and
-- 20260902090000_employers.sql, re-run list_connections_activity from
-- 20261114120000 and list_connection_recent_growth from 0103, and
-- grant execute on get_validation_request_contact(uuid) to authenticated.

-- 1. Membership writes only through the API and invite functions.
drop policy if exists "Platform admins and org admins can add organisation members" on public.organisation_members;
drop policy if exists "Employer admins can add employer members" on public.employer_members;
drop policy if exists "Employer admins can update employer members" on public.employer_members;

-- 2. The feed respects skill visibility.
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
      and s.visible_on_profile = true
      and p.skills_profile_visible = true

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
      and s.visible_on_profile = true
      and p.skills_profile_visible = true

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
      and s.visible_on_profile = true
      and p.skills_profile_visible = true

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
      and s.visible_on_profile = true
      and p.skills_profile_visible = true
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
      and s.visible_on_profile = true
      and p.skills_profile_visible = true

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
      and s.visible_on_profile = true
      and p.skills_profile_visible = true

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
      and s.visible_on_profile = true
      and p.skills_profile_visible = true

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
      and s.visible_on_profile = true
      and p.skills_profile_visible = true
  ) events
  order by event_at desc
  limit p_limit
$function$;

create or replace function public.list_connection_recent_growth(p_user_id uuid, p_limit int default 5)
returns table (
  skill_id uuid,
  skill_name text,
  level int,
  previous_level int,
  assessed_at timestamptz,
  target_level int,
  target_date date
)
language sql
security definer
set search_path = public
stable
as $$
  select
    sa.skill_id,
    s.name,
    sa.level,
    (
      select sa2.level
      from skill_assessments sa2
      where sa2.skill_id = sa.skill_id
        and sa2.axis = 'practical'
        and sa2.assessed_at < sa.assessed_at
      order by sa2.assessed_at desc
      limit 1
    ) as previous_level,
    sa.assessed_at,
    t.target_level,
    t.target_date
  from skill_assessments sa
  join skills s on s.id = sa.skill_id
  left join lateral (
    select target_level, target_date
    from skill_targets
    where skill_id = sa.skill_id and user_id = p_user_id
    order by created_at desc
    limit 1
  ) t on true
  where sa.axis = 'practical'
    and sa.user_id = p_user_id
    and sa.assessed_at >= now() - interval '28 days'
    and sa.user_id <> auth.uid()
    and s.visible_on_profile = true
    and is_connected(auth.uid(), sa.user_id)
    and exists (
      select 1 from profiles p
      where p.id = p_user_id and p.activity_feed_visible = true and p.skills_profile_visible = true
    )
  order by sa.assessed_at desc
  limit p_limit
$$;

-- 3. A validator's email stays on the server.
revoke execute on function public.get_validation_request_contact(uuid) from public, anon, authenticated;
