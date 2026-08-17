-- 0041 granted validators SELECT on skill_course_links (the join row) for
-- skills they're validating, but never on courses itself -- so the embedded
-- `skill_course_links.select('courses(name, completed_date)')` join used by
-- the validation review screen silently dropped the course under RLS,
-- leaving linked-training evidence invisible. Mirrors the scoping used by
-- every other "Validators can view ... for skills they're validating" policy
-- from 0041: readable only via a skill_course_links row tied to a skill the
-- validator has an active/decided request for.
create policy "Validators can view courses linked to skills they're validating"
  on courses for select
  using (
    exists (
      select 1
      from skill_course_links scl
      join skill_validation_requests svr on svr.skill_id = scl.skill_id
      where scl.course_id = courses.id
        and svr.validator_id = auth.uid()
    )
  );
