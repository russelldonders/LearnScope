-- Two efficiency fixes, no change in who can read or write what: every
-- function here is SECURITY INVOKER, so the caller's own RLS still decides
-- which rows it sees or changes. search_path is public (not empty) because
-- existing RLS helpers such as is_skill_validator name their tables unqualified.
--
-- 1. get_my_skill_progress_counts: the dashboard's "Up next" list needs a
--    handful of counts/flags per skill. It used to download every
--    assessment, peer rating, invite, activity statement (full jsonb),
--    course link, target and validation request for every skill -- growing
--    with the learner's whole history, and passing every skill id in the
--    request URL. This returns one small row per skill instead.
--
-- 2. reorder_course_sections / reorder_course_content_links: a drag-and-drop
--    reorder used to send one UPDATE request per moved row, one after
--    another, so a failure part-way left the order half-saved. Each is now a
--    single statement: all rows move, or none do.

create function public.get_my_skill_progress_counts()
returns table (
  skill_id uuid,
  self_practical_count int,
  self_knowledge_count int,
  peer_rating_count int,
  rate_invite_count int,
  activity_count int,
  has_target boolean,
  has_pending_validation boolean,
  has_pending_course boolean,
  has_completed_course boolean
)
language sql
stable
security invoker
set search_path = public
as $$
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
      bool_or(c.completed_date is null) as pending,
      bool_or(c.completed_date is not null) as completed
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
$$;

revoke all on function public.get_my_skill_progress_counts() from public, anon;
grant execute on function public.get_my_skill_progress_counts() to authenticated;

-- Positions follow the array order (0-based). Rows already in place are
-- skipped, matching the old client-side behaviour.
create function public.reorder_course_sections(p_section_ids uuid[])
returns void
language sql
security invoker
set search_path = public
as $$
  update public.course_sections s
  set position = (o.ordinal - 1)::int
  from unnest(p_section_ids) with ordinality as o(id, ordinal)
  where s.id = o.id and s.position is distinct from (o.ordinal - 1)::int
$$;

-- Moves every listed link into p_section_id (null = ungrouped) in the given
-- order, as one statement.
create function public.reorder_course_content_links(p_section_id uuid, p_link_ids uuid[])
returns void
language sql
security invoker
set search_path = public
as $$
  update public.course_content_links l
  set section_id = p_section_id, position = (o.ordinal - 1)::int
  from unnest(p_link_ids) with ordinality as o(id, ordinal)
  where l.id = o.id
    and (l.position is distinct from (o.ordinal - 1)::int or l.section_id is distinct from p_section_id)
$$;

revoke all on function public.reorder_course_sections(uuid[]) from public, anon;
revoke all on function public.reorder_course_content_links(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_course_sections(uuid[]) to authenticated;
grant execute on function public.reorder_course_content_links(uuid, uuid[]) to authenticated;
