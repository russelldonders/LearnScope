-- "What your connections are up to": an opt-in feed of recent milestones
-- from people the learner is connected to. Off by default, single global
-- toggle -- matching every other cross-user visibility flag so far
-- (skills_profile_visible 0016, profile_visible_to_skill_matches 0058).
alter table profiles add column activity_feed_visible boolean not null default false;

-- Aggregates recent milestone events across six source tables into one
-- shape. Each branch independently re-checks is_connected() and the
-- actor's own activity_feed_visible opt-in -- same SECURITY DEFINER
-- pattern as list_skill_matches (0058): the function can see past normal
-- per-row RLS, but only ever returns rows the caller is actually allowed
-- to see, checked row-by-row rather than relying on table-level grants.
--
-- Every date used here is when the record was created on the platform
-- (created_at, or date_added for skills, which has served that role since
-- 0001), never a backdated effective/historical date (assessed_at,
-- start_date, target_date) -- this is a feed of recent activity, not a
-- re-sorted timeline, so a historical entry backdated to years ago must
-- not flood someone's feed as if it just happened.
create or replace function list_connections_activity(p_limit int default 30)
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
$$;

grant execute on function list_connections_activity(int) to authenticated;
