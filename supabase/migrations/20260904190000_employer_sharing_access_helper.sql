-- Ninth domain-by-domain step of the additive learning-profile ownership
-- transition (see 20260904090000_learning_profile_access_helper.sql for the
-- full design rationale). Starts the "employer sharing" domain named in
-- docs/claude-account-portability-handoff.md, converting the four tables
-- whose shape already matches an established pattern from this transition:
--
-- - employer_data_access_requests (learner_id): single-owner, same shape as
--   skills/courses/experience. New additive policy alongside the existing
--   "Learners can view their own data access requests" and "Employer admins
--   can view their employer's data access requests" policies.
-- - employer_skill_suggestions (learner_id): single-owner, same shape.
-- - course_assignments (assigned_to): single-owner, same shape (owning
--   column is named assigned_to rather than learner_id/user_id, but the
--   principle is identical).
-- - employer_data_access_shared_skills (no direct learner column; joins via
--   request_id to employer_data_access_requests.learner_id): dependent
--   shape, same pattern as manager_team_shared_skills joining via
--   membership_id.
--
-- None of this changes an employer admin's own is_employer_admin-gated
-- visibility; it only extends what a linked account of the *learner* can
-- see to match what the learner's own login could already see.
--
-- Deliberately NOT included here: employer_role_profiles/employer_role_
-- assignments (a materially different, mutual-consent role-alignment shape
-- that needs its own dedicated review, not a mechanical reuse of this
-- pattern) and employer_members/organisation_members/profile_share_links
-- (membership and account-setting records, not learning-profile content --
-- same exclusion already made for these in
-- 20260904120000_skills_courses_experience_dependents_access_helper.sql).
--
-- Checked before writing this migration: all four tables have exactly the
-- policies quoted above, all permissive (not restrictive), none with
-- `using (true)`. employer_data_access_requests, employer_skill_
-- suggestions, and course_assignments already have `grant select ... to
-- authenticated` from 20260903160000_restore_learner_action_read_grants.sql.
-- employer_data_access_shared_skills does not -- confirmed via
-- information_schema.role_table_grants against a fresh local reset --
-- so 20260904191500_grant_employer_data_access_shared_skills_select.sql
-- adds it, the fourth instance of the same local/Staging ambient-ACL
-- divergence documented in earlier migrations of this transition.

create policy "Linked accounts can view accessible data access requests"
  on employer_data_access_requests for select
  to authenticated
  using (private.can_view_learning_profile(learner_id));

create policy "Linked accounts can view accessible skill suggestions"
  on employer_skill_suggestions for select
  to authenticated
  using (private.can_view_learning_profile(learner_id));

create policy "Linked accounts can view accessible course assignments"
  on course_assignments for select
  to authenticated
  using (private.can_view_learning_profile(assigned_to));

create policy "Linked accounts can view accessible shared skill records"
  on employer_data_access_shared_skills for select
  to authenticated
  using (
    exists (
      select 1
      from public.employer_data_access_requests r
      where r.id = request_id
        and private.can_view_learning_profile(r.learner_id)
    )
  );
