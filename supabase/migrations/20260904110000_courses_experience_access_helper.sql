-- Second domain-by-domain step of the additive learning-profile ownership
-- transition (see 20260904090000_learning_profile_access_helper.sql for the
-- full design rationale). Converts the two next domain root tables from the
-- handoff's dependency inventory: courses and experience. Same shape as the
-- skills conversion -- existing "for all" owner policies are unchanged; each
-- table gains one new, additive, SELECT-only policy using the existing
-- private.can_view_learning_profile(uuid) helper.
--
-- Checked before writing this migration: neither courses nor experience has
-- a pre-existing `using (true)` policy (unlike profiles), and every existing
-- policy on both tables is permissive (not restrictive), so this addition
-- is purely additive and cannot be narrowed or blocked by any of them.
--
-- Still unconverted: skills' and courses'/experience's own dependent tables
-- (assessments, quizzes, peer ratings, targets, tags, course-experience
-- links, skill-course/skill-experience links, validation requests, xAPI
-- statements and launch sessions, employer role alignment references), plus
-- actions, evidence, connections, and manager/employer sharing paths that
-- reference these domains. Each remains its own reviewable increment.

create policy "Linked accounts can view accessible courses"
  on courses for select
  to authenticated
  using (private.can_view_learning_profile(user_id));

create policy "Linked accounts can view accessible experience"
  on experience for select
  to authenticated
  using (private.can_view_learning_profile(user_id));
