-- Recognizes an AI-synthesized baseline assessment as a third assessment
-- source alongside the existing self/course, so it lands in the same
-- history table rather than a parallel one.
alter table skill_assessments drop constraint skill_assessments_source_check;
alter table skill_assessments add constraint skill_assessments_source_check
  check (source in ('self', 'course', 'ai_baseline'));

-- Lets a skill's owner see whether one of their peer raters also tracks
-- that same skill themselves (matched via the shared skill_library entry),
-- and how far along that rater's own copy is. Used client-side to weight
-- peer ratings when the AI proposes a baseline level -- a rater who is
-- further along in their own development of the same skill counts for more.
-- Restricted to the skill's own owner; a rater has already disclosed their
-- name and opinion on this exact skill by rating it, so surfacing their own
-- progress on that same skill back to the owner is a bounded extension of
-- that existing disclosure, not a new one.
create or replace function get_peer_rater_progress(p_skill_id uuid)
returns table (
  peer_rating_id uuid,
  rater_level int,
  rater_lifecycle_stage text
)
language sql
security definer
set search_path = public
as $$
  select
    spr.id as peer_rating_id,
    rs.level as rater_level,
    rs.lifecycle_stage as rater_lifecycle_stage
  from skill_peer_ratings spr
  join skills target on target.id = spr.skill_id
  left join skills rs
    on rs.user_id = spr.rater_id
    and rs.library_skill_id = target.library_skill_id
    and target.library_skill_id is not null
  where spr.skill_id = p_skill_id
    and target.user_id = auth.uid();
$$;

grant execute on function get_peer_rater_progress(uuid) to authenticated;
