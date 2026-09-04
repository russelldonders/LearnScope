-- Fourth domain-by-domain step of the additive learning-profile ownership
-- transition (see 20260904090000_learning_profile_access_helper.sql for the
-- full design rationale). Converts `connections` (0058_skill_discovery_and_
-- connections.sql): unlike skills/courses/experience and their dependents,
-- this table has two owning parties (user_a_id, user_b_id), not one, so it
-- needs its own policy shape rather than reusing the single-column pattern
-- verbatim.
--
-- A connection is visible to a caller if they can view *either* side's
-- learning profile through private.can_view_learning_profile -- i.e. they
-- are that side's own owner, or a verified-linked account holding an active
-- workspace_access grant for that side. This mirrors what each side's own
-- linked account should already see about that side's standing connections;
-- it does not let a linked account of neither party see the row, and it does
-- not require both parties to be linkable at once.
--
-- The existing "Users can view their own connections" policy (auth.uid() =
-- user_a_id or auth.uid() = user_b_id) is unchanged; this is a new, additive,
-- SELECT-only policy. Checked before writing this migration: connections has
-- exactly one existing policy, it is permissive (not restrictive), and it
-- has no `using (true)` clause. connection_requests and connection_invites
-- are deliberately NOT converted here -- they are pending, two-party
-- invitation flows with different access semantics (matching the same
-- exclusion already made for validation requests and connection invitations/
-- requests in 20260904120000_skills_courses_experience_dependents_access_
-- helper.sql) and remain their own reviewable increment.

create policy "Linked accounts can view accessible connections"
  on connections for select
  to authenticated
  using (
    private.can_view_learning_profile(user_a_id)
    or private.can_view_learning_profile(user_b_id)
  );
