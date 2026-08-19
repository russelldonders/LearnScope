-- skill_course_links' base policy ("Users manage their own skill-course
-- links", 0018) checks `exists (select 1 from courses where courses.id =
-- course_id and courses.user_id = auth.uid())` as part of its WITH CHECK.
-- Evaluating that subquery re-applies courses' own SELECT policies, one of
-- which ("Validators can view courses linked to skills they're validating",
-- 0044, redefined in 0051) queries skill_course_links again -- a live
-- two-way RLS dependency Postgres reports as "infinite recursion detected in
-- policy for relation skill_course_links". Hit on any INSERT into
-- skill_course_links (e.g. Course Catalogue -> Enrol from a skill's Training
-- tab, via enrolInCatalogueCourse in src/lib/courseCatalogue.js).
--
-- Same shape of bug as 0017 (skills <-> skill_peer_ratings), fixed the same
-- way: move the cross-table check into a SECURITY DEFINER function so it
-- bypasses RLS internally instead of re-entering skill_course_links'
-- policies while skill_course_links' own policy is still being evaluated.
create or replace function is_course_linked_to_validating_skill(p_course_id uuid, p_validator_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from skill_course_links scl
    join skill_validation_requests svr on svr.skill_id = scl.skill_id
    where scl.course_id = p_course_id
      and svr.validator_id = p_validator_id
  )
$$;

grant execute on function is_course_linked_to_validating_skill(uuid, uuid) to authenticated;

drop policy "Validators can view courses linked to skills they're validating" on courses;
create policy "Validators can view courses linked to skills they're validating"
  on courses for select
  using (is_course_linked_to_validating_skill(courses.id, auth.uid()));
