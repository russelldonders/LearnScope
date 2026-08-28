-- Backs two additions to SkillsProfile.jsx: a "member since" date in the
-- header, and a "recent growth" panel replacing the plain activity feed.

-- auth.users.created_at is the true signup date -- deliberately not
-- duplicated onto profiles (would be a second representation of the same
-- fact, out of sync the moment either drifted). profiles.full_name/
-- avatar_url are already visible to any authenticated user (see 0061's
-- "Authenticated users can view profile names" policy), so signup date
-- sits at the same visibility level -- identity-ish metadata, not the
-- skill/activity data that's actually access-gated.
create or replace function get_member_since(p_user_id uuid)
returns timestamptz
language sql
security definer
set search_path = public
stable
as $$
  select created_at from auth.users where id = p_user_id
$$;

grant execute on function get_member_since(uuid) to authenticated;

-- Same shape as Dashboard.jsx's own loadRecentGrowth (recent practical-axis
-- level jumps, each paired with the level just before it and any current
-- target), just scoped to one other person and re-derived server-side --
-- skill_assessments/skill_targets are RLS'd to their own owner, so a
-- connection has no client-side way to read this directly. Gated by the
-- exact same is_connected + activity_feed_visible check as
-- list_connections_activity (0063/0098): this is the same privacy boundary,
-- just a richer per-skill shape than that feed's flat event rows.
create or replace function list_connection_recent_growth(p_user_id uuid, p_limit int default 5)
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
    and is_connected(auth.uid(), sa.user_id)
    and exists (
      select 1 from profiles p where p.id = p_user_id and p.activity_feed_visible = true
    )
  order by sa.assessed_at desc
  limit p_limit
$$;

grant execute on function list_connection_recent_growth(uuid, int) to authenticated;
