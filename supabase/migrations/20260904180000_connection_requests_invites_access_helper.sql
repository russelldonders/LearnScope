-- Eighth domain-by-domain step of the additive learning-profile ownership
-- transition (see 20260904090000_learning_profile_access_helper.sql for the
-- full design rationale). Converts connection_requests and connection_invites
-- (0058_skill_discovery_and_connections.sql), deferred from both the
-- skills-dependents increment and the connections increment as "different
-- access semantics" pending review -- reviewed now:
--
-- connection_requests (requester_id, recipient_id) is two-party, the same
-- shape as connections itself: visible if the caller can view *either*
-- side's learning profile. Existing "Users can view requests they sent or
-- received" policy is unchanged.
--
-- connection_invites (inviter_id, share-code based, single owner) is the
-- same shape as skills/courses/experience: visible if the caller can view
-- the inviter's learning profile. accepted_by is not given any additional
-- visibility here -- the existing schema never granted the accepter read
-- access to the invite either, so this stays purely additive to what the
-- inviter's own login could already see. Existing "Inviters can view their
-- own invites" policy is unchanged.
--
-- Checked before writing this migration: both tables have exactly one
-- existing SELECT policy each, both permissive (not restrictive), neither
-- with `using (true)`.
--
-- connection_requests already has `grant select ... to authenticated` (from
-- 20260903160000_restore_learner_action_read_grants.sql). connection_invites
-- does not -- confirmed via information_schema.role_table_grants against a
-- fresh local reset -- so 20260904181500_grant_connection_invites_select.sql
-- adds it, matching the same local/Staging ambient-ACL divergence documented
-- for connections, courses, and their dependents in earlier migrations of
-- this transition.

create policy "Linked accounts can view accessible connection requests"
  on connection_requests for select
  to authenticated
  using (
    private.can_view_learning_profile(requester_id)
    or private.can_view_learning_profile(recipient_id)
  );

create policy "Linked accounts can view accessible connection invites"
  on connection_invites for select
  to authenticated
  using (private.can_view_learning_profile(inviter_id));
