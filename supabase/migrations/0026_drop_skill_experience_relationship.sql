-- Drop the skill/experience "relationship" distinction (first_acquired /
-- developed / applied / demonstrated). A skill is either associated with an
-- experience or it isn't -- the extra dimension was never surfaced
-- meaningfully in the UI, and the only remaining writers (auto-linking a
-- newly created skill, and syncing "part of my current role") always used a
-- single hardcoded value anyway.
--
-- Dedupe any pre-existing rows that used more than one relationship for the
-- same (skill_id, experience_id) pair down to one, keeping the earliest,
-- before tightening the unique constraint.
--
-- skill_course_links carries the same shape for a different purpose
-- (courses, not experiences) and is intentionally left untouched.
delete from skill_experience_links
where id not in (
  select distinct on (skill_id, experience_id) id
  from skill_experience_links
  order by skill_id, experience_id, created_at asc
);

-- CASCADE drops the old (skill_id, experience_id, relationship) unique
-- constraint along with the column, since it depends on it.
alter table skill_experience_links drop column relationship cascade;

alter table skill_experience_links
  add constraint skill_experience_links_skill_id_experience_id_key unique (skill_id, experience_id);
