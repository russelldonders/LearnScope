-- Tenth domain-by-domain step of the additive learning-profile ownership
-- transition (see 20260904090000_learning_profile_access_helper.sql for the
-- full design rationale). Converts skill_peer_ratings and skill_validation_
-- requests, deferred from the skills-dependents increment as "different
-- access semantics" (peer ratings, validation requests) pending review --
-- reviewed now:
--
-- skill_peer_ratings (0010_connections.sql, its SELECT policy later
-- recreated by 0017 for RLS-recursion reasons but unchanged in meaning) has
-- exactly two existing SELECT policies: "Skill owners can view ratings on
-- their skills" (auth.uid() = skill_owner_id -- single-owner, same shape as
-- skills/courses/experience) and "Validators can view peer ratings for
-- skills they're validating" (is_skill_validator(skill_id, auth.uid()) --
-- an unrelated third-party reviewer path, left untouched). rater_id has no
-- SELECT policy of its own today (a rater cannot look back at ratings they
-- gave), so this migration adds no visibility for raters either -- purely
-- additive to what the skill owner's own login could already see.
--
-- skill_validation_requests (0041_skill_validation.sql) is two-party:
-- requester_id (the skill owner requesting validation) and validator_id
-- (another skill owner performing it), each with their own existing SELECT
-- policy. Same either-side shape as connections/connection_requests: visible
-- if the caller can view either party's learning profile.
--
-- Checked before writing this migration: both tables' policies are exactly
-- as quoted above, all permissive (not restrictive), none with
-- `using (true)`. skill_validation_requests already has `grant select ...
-- to authenticated` from 20260903160000_restore_learner_action_read_grants.
-- sql. skill_peer_ratings does not -- confirmed via information_schema.
-- role_table_grants against a fresh local reset -- so
-- 20260904201500_grant_skill_peer_ratings_select.sql adds it, the fifth
-- instance of the same local/Staging ambient-ACL divergence documented in
-- earlier migrations of this transition.

create policy "Linked accounts can view accessible peer ratings"
  on skill_peer_ratings for select
  to authenticated
  using (private.can_view_learning_profile(skill_owner_id));

create policy "Linked accounts can view accessible validation requests"
  on skill_validation_requests for select
  to authenticated
  using (
    private.can_view_learning_profile(requester_id)
    or private.can_view_learning_profile(validator_id)
  );
