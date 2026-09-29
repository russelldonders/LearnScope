-- RLS performance, no change in who can see or write what. Each policy
-- below is restated exactly as it's live on Staging, except auth.uid() is
-- wrapped as (select auth.uid()) -- Postgres then evaluates it once per
-- query (an initplan) instead of once per row. Generated from pg_policies
-- so the expressions match the current definitions, not older migrations.
--
-- Plus the two foreign-key indexes the owner policies and skill pages
-- filter on but never had.

alter policy "Users manage their own course-experience links" on public.course_experience_links
  using (((select auth.uid()) = user_id))
  with check ((((select auth.uid()) = user_id) AND (EXISTS ( SELECT 1
   FROM courses
  WHERE ((courses.id = course_experience_links.course_id) AND (courses.user_id = (select auth.uid()))))) AND (EXISTS ( SELECT 1
   FROM experience
  WHERE ((experience.id = course_experience_links.experience_id) AND (experience.user_id = (select auth.uid())))))));

alter policy "Users manage their own courses" on public.courses
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

alter policy "Validators can view courses linked to skills they're validating" on public.courses
  using (is_course_linked_to_validating_skill(id, (select auth.uid())));

alter policy "Users manage their own experience" on public.experience
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

alter policy "Users manage their own profile" on public.profiles
  using (((select auth.uid()) = id))
  with check (((select auth.uid()) = id));

alter policy "Users manage their own skill assessments" on public.skill_assessments
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

alter policy "Validators can view assessments for skills they're validating" on public.skill_assessments
  using (is_skill_validator(skill_id, (select auth.uid())));

alter policy "Users manage their own skill-course links" on public.skill_course_links
  using (((select auth.uid()) = user_id))
  with check ((((select auth.uid()) = user_id) AND (EXISTS ( SELECT 1
   FROM skills
  WHERE ((skills.id = skill_course_links.skill_id) AND (skills.user_id = (select auth.uid()))))) AND (EXISTS ( SELECT 1
   FROM courses
  WHERE ((courses.id = skill_course_links.course_id) AND (courses.user_id = (select auth.uid())))))));

alter policy "Validators can view course links for skills they're validating" on public.skill_course_links
  using (is_skill_validator(skill_id, (select auth.uid())));

alter policy "Users manage their own skill-experience links" on public.skill_experience_links
  using (((select auth.uid()) = user_id))
  with check ((((select auth.uid()) = user_id) AND (EXISTS ( SELECT 1
   FROM skills
  WHERE ((skills.id = skill_experience_links.skill_id) AND (skills.user_id = (select auth.uid()))))) AND (EXISTS ( SELECT 1
   FROM experience
  WHERE ((experience.id = skill_experience_links.experience_id) AND (experience.user_id = (select auth.uid())))))));

alter policy "Raters can view ratings they gave" on public.skill_peer_ratings
  using (((select auth.uid()) = rater_id));

alter policy "Skill owners can view ratings on their skills" on public.skill_peer_ratings
  using (((select auth.uid()) = skill_owner_id));

alter policy "Validators can view peer ratings for skills they're validating" on public.skill_peer_ratings
  using (is_skill_validator(skill_id, (select auth.uid())));

alter policy "Connections can view tags on visible skills" on public.skill_tags
  using ((EXISTS ( SELECT 1
   FROM (skills s
     JOIN profiles p ON ((p.id = s.user_id)))
  WHERE ((s.id = skill_tags.skill_id) AND (s.visible_on_profile = true) AND (p.skills_profile_visible = true) AND is_connected((select auth.uid()), s.user_id)))));

alter policy "Users manage their own skill tags" on public.skill_tags
  using (((select auth.uid()) = user_id))
  with check ((((select auth.uid()) = user_id) AND (EXISTS ( SELECT 1
   FROM skills
  WHERE ((skills.id = skill_tags.skill_id) AND (skills.user_id = (select auth.uid())))))));

alter policy "Users manage their own skill targets" on public.skill_targets
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

alter policy "Validators can view targets for skills they're validating" on public.skill_targets
  using (is_skill_validator(skill_id, (select auth.uid())));

alter policy "Connections can view visible skills profiles" on public.skills
  using (((visible_on_profile = true) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = skills.user_id) AND (p.skills_profile_visible = true)))) AND is_connected((select auth.uid()), user_id)));

alter policy "Employers with granted access can view skills" on public.skills
  using (is_skill_shared_with_employer(id, (select auth.uid())));

alter policy "Skill-search matches can view opted-in profiles" on public.skills
  using (((visible_on_profile = true) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = skills.user_id) AND (p.profile_visible_to_skill_matches = true)))) AND is_skill_search_match((select auth.uid()), user_id, library_skill_id)));

alter policy "Skills open to being asked to validate are discoverable" on public.skills
  using (((lifecycle_stage = ANY (ARRAY['validated'::text, 'maintained'::text])) AND ((offer_validate_others = true) OR ((offer_validate_connections = true) AND is_connected((select auth.uid()), user_id)))));

alter policy "Users manage their own skills" on public.skills
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

alter policy "Validators can view skills they're validating" on public.skills
  using (is_skill_validator(id, (select auth.uid())));

alter policy "Users manage their own activity-skill links" on public.xapi_statement_skills
  using (((select auth.uid()) = user_id))
  with check ((((select auth.uid()) = user_id) AND (EXISTS ( SELECT 1
   FROM xapi_statements xs
  WHERE ((xs.id = xapi_statement_skills.statement_id) AND (xs.user_id = (select auth.uid())))))));

alter policy "Validators can view activity-skill links for skills they're val" on public.xapi_statement_skills
  using ((EXISTS ( SELECT 1
   FROM skill_validation_requests svr
  WHERE ((svr.skill_id = xapi_statement_skills.skill_id) AND (svr.validator_id = (select auth.uid()))))));

alter policy "Users manage their own xapi statements" on public.xapi_statements
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

alter policy "Validators can view activity for skills they're validating" on public.xapi_statements
  using (((skill_id IS NOT NULL) AND is_skill_validator(skill_id, (select auth.uid()))));

create index if not exists skill_assessments_user_id_idx on public.skill_assessments (user_id);
create index if not exists skill_peer_ratings_skill_owner_id_idx on public.skill_peer_ratings (skill_owner_id);
