-- Third domain-by-domain step of the additive learning-profile ownership
-- transition (see 20260904090000_learning_profile_access_helper.sql for the
-- full design rationale). Converts the skills/courses/experience dependent
-- tables from the handoff's dependency inventory that follow the exact same
-- shape as their parent tables: a direct, not-null `user_id uuid` column and
-- only permissive RLS policies (checked via pg_policy.polpermissive before
-- writing this migration, so the new additive policy cannot be narrowed or
-- blocked by any existing one).
--
--   Skills:     skill_assessments, skill_baseline_quizzes, skill_tags,
--               skill_targets, skill_course_links, skill_experience_links
--   Courses:    course_experience_links, course_content_progress
--   Experience: (no additional dependents in this shape; see below)
--   xAPI:       xapi_statements, xapi_statement_skills
--
-- Each gains one new, additive, SELECT-only policy using the existing
-- private.can_view_learning_profile(uuid) helper; every existing policy
-- (owner "for all", or any validator/employer/connection/provider-admin
-- policy) is unchanged.
--
-- xapi_launch_sessions is deliberately EXCLUDED despite matching the same
-- user_id/permissive-policies shape: an independent security review found
-- its `token` column is a live bearer credential -- api/xapi/[...path].js
-- authenticates the LRS proxy purely by looking up this token via the
-- service role, no further check. Exposing it as "read-only" would actually
-- grant a linked account the ability to read up to 200 of the owner's real
-- xAPI statements AND forge new ones (persisted with the real owner's
-- user_id) for up to the session's 4-hour lifetime -- a write/impersonation
-- capability, not view access, and squarely against "historical accuracy"/
-- "evidence over unsupported claims" in CLAUDE.md. If a linked account ever
-- needs to see launch-session state, it must go through a narrow view or
-- RPC that omits `token`, not a direct table policy.
--
-- Deliberately NOT included here (different access semantics, per
-- CLAUDE.md's explicit warning that skills/courses/experience/connections/
-- xAPI/manager/employer sharing are not interchangeable): peer ratings,
-- validation requests, connection invitations/requests, searchable skills,
-- employer-shared skills, manager-shared skills, public share-link skills,
-- parent/child experience links, employer role alignment references,
-- employer_members, organisation_members, and profile_share_links (the
-- last three are membership/account-setting records, not learning-profile
-- content). Each remains its own reviewable increment.

create policy "Linked accounts can view accessible skill assessments"
  on skill_assessments for select
  to authenticated
  using (private.can_view_learning_profile(user_id));

create policy "Linked accounts can view accessible skill baseline quizzes"
  on skill_baseline_quizzes for select
  to authenticated
  using (private.can_view_learning_profile(user_id));

create policy "Linked accounts can view accessible skill tags"
  on skill_tags for select
  to authenticated
  using (private.can_view_learning_profile(user_id));

create policy "Linked accounts can view accessible skill targets"
  on skill_targets for select
  to authenticated
  using (private.can_view_learning_profile(user_id));

create policy "Linked accounts can view accessible skill-course links"
  on skill_course_links for select
  to authenticated
  using (private.can_view_learning_profile(user_id));

create policy "Linked accounts can view accessible skill-experience links"
  on skill_experience_links for select
  to authenticated
  using (private.can_view_learning_profile(user_id));

create policy "Linked accounts can view accessible course-experience links"
  on course_experience_links for select
  to authenticated
  using (private.can_view_learning_profile(user_id));

create policy "Linked accounts can view accessible course content progress"
  on course_content_progress for select
  to authenticated
  using (private.can_view_learning_profile(user_id));

create policy "Linked accounts can view accessible xapi statements"
  on xapi_statements for select
  to authenticated
  using (private.can_view_learning_profile(user_id));

create policy "Linked accounts can view accessible xapi statement-skill links"
  on xapi_statement_skills for select
  to authenticated
  using (private.can_view_learning_profile(user_id));
