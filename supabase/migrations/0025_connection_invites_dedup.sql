-- Revoke pre-existing duplicate pending invites (same skill + email, more
-- than one still pending) before adding the constraint below, keeping the
-- oldest of each group. Revoking rather than deleting preserves the row for
-- history. There is no user-facing DELETE/UPDATE policy on this table (only
-- the accept_invite_and_rate() function can change status), so this has to
-- run here with the SQL editor's elevated privileges.
update connection_invites ci
set status = 'revoked'
where ci.status = 'pending'
  and ci.invitee_email is not null
  and ci.id not in (
    select distinct on (skill_id, lower(invitee_email)) id
    from connection_invites
    where status = 'pending' and invitee_email is not null
    order by skill_id, lower(invitee_email), created_at asc
  );

-- Prevent sending a second invite to the same email for the same skill while
-- one is still outstanding. Scoped to status='pending' (not a permanent
-- block) so a fresh invite can still be sent after the first was accepted or
-- revoked -- skills change over time, and a person may reasonably be asked
-- to rate the same skill again later.
create unique index connection_invites_unique_pending_idx
  on connection_invites (skill_id, lower(invitee_email))
  where status = 'pending' and invitee_email is not null;
