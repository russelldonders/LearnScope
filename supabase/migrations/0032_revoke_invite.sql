-- Lets an inviter revoke their own pending connection invite. Previously
-- only accept_invite_and_rate() could change status (for the invitee's
-- accept flow); this adds the one narrow transition an inviter is allowed
-- to make themselves -- pending to revoked, on their own invites only.
create policy "Inviters can revoke their own pending invites"
  on connection_invites for update
  using (auth.uid() = inviter_id and status = 'pending')
  with check (auth.uid() = inviter_id and status = 'revoked');
