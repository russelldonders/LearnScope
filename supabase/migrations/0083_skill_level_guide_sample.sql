-- Skill-specific level guide text (practical_level_guide/knowledge_level_
-- guide, 0047/0057) is cached per learner instance on `skills`, not shared
-- by `skill_library` -- a platform admin has no standing RLS access to any
-- learner's own skills rows (owner-only, 0001), so the admin skill detail
-- page needs a way to see *some* real, already-generated guide for a
-- library skill. Anonymous, content-only lookup -- same shape as
-- count_skill_trackers (0053) and skill_level_stats (0076): no user
-- identity in the result, so no privacy opt-in needed, open to any
-- authenticated user like those two. Prefers a row with both axes
-- populated, then the most recently added.
create or replace function skill_level_guide_sample(p_library_skill_id uuid)
returns table (practical_level_guide jsonb, knowledge_level_guide jsonb)
language sql
security definer
set search_path = public
stable
as $$
  select practical_level_guide, knowledge_level_guide
  from skills
  where library_skill_id = p_library_skill_id
    and (practical_level_guide is not null or knowledge_level_guide is not null)
  order by
    (practical_level_guide is not null and knowledge_level_guide is not null) desc,
    date_added desc
  limit 1
$$;

grant execute on function skill_level_guide_sample(uuid) to authenticated;
