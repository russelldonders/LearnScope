-- Lets list_connections_activity (0063) be scoped to a single connection
-- instead of always aggregating across all of them -- needed so
-- SkillsProfile.jsx can show "what this person's been up to" on their own
-- profile page, reusing the exact same query/privacy checks (is_connected +
-- the actor's own activity_feed_visible opt-in) rather than a second
-- function. p_user_id defaults to null, which preserves the existing
-- "across every connection" behavior Dashboard.jsx already relies on.
create or replace function list_connections_activity(p_limit int default 30, p_user_id uuid default null)
returns table (
  event_type text,
  actor_id uuid,
  full_name text,
  avatar_url text,
  event_at timestamptz,
  skill_name text,
  level int,
  detail text
)
language sql
security definer
set search_path = public
stable
as $$
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
$$;

grant execute on function list_connections_activity(int, uuid) to authenticated;
