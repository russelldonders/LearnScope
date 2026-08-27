-- Per-knowledge-level breakdown of self-rated vs assessed trackers, for the
-- platform admin skill detail page's new "assessment stats" view. Same
-- anonymous, count-only shape as skill_level_stats (0076)/count_skill_trackers
-- (0053) -- never returns user identities, just grouped counts, so it needs
-- no privacy opt-in.
--
-- Buckets each tracker under their *current* skills.knowledge_level (the
-- same column skill_level_stats groups practical level by), using the source
-- of that user's most recent knowledge-axis skill_assessments row to decide
-- self vs assessed. A tracker with no knowledge-axis assessment row at all
-- (knowledge_level set some other way) counts toward neither bucket.
create or replace function skill_knowledge_level_source_stats(p_library_skill_id uuid)
returns table (level int, self_count int, assessed_count int)
language sql
security definer
set search_path = public
stable
as $$
  with latest_knowledge_assessment as (
    select distinct on (sa.user_id)
      sa.user_id, sa.source
    from skill_assessments sa
    join skills s on s.id = sa.skill_id
    where s.library_skill_id = p_library_skill_id
      and sa.axis = 'knowledge'
    order by sa.user_id, sa.assessed_at desc
  )
  select
    s.knowledge_level as level,
    count(*) filter (where lka.source = 'self')::int as self_count,
    count(*) filter (where lka.source is not null and lka.source != 'self')::int as assessed_count
  from skills s
  left join latest_knowledge_assessment lka on lka.user_id = s.user_id
  where s.library_skill_id = p_library_skill_id
    and s.knowledge_level is not null
  group by s.knowledge_level
  order by s.knowledge_level
$$;

grant execute on function skill_knowledge_level_source_stats(uuid) to authenticated;
