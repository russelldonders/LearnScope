-- Lets an invitee dismiss a pending invite addressed to their own verified
-- email, for either invite_type. Needed most for 'recommend' invites: unlike
-- a rating (which always succeeds), accept_invite_and_recommend can fail
-- permanently for a given invitee (e.g. they already track a same-named
-- skill -- see skills_user_id_name_lower_idx), and until now there was no
-- way for that invitee to get the invite out of their own pending-actions
-- list/badge count (only the inviter could revoke it, via the policy added
-- in 0032). Reuses the existing 'revoked' status rather than adding a new
-- one -- from the data model's perspective a declined invite and a
-- withdrawn one are the same "no longer active, never acted on" state.
create or replace function decline_invite(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite connection_invites%rowtype;
  v_own_email text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from connection_invites where share_code = p_code for update;
  if not found then
    raise exception 'Invite not found';
  end if;
  if v_invite.status != 'pending' then
    raise exception 'This invite has already been used.';
  end if;

  select email into v_own_email from auth.users where id = auth.uid();
  if v_invite.invitee_email is null or lower(v_invite.invitee_email) != lower(v_own_email) then
    raise exception 'You can''t decline this invite.';
  end if;

  update connection_invites set status = 'revoked' where id = v_invite.id;
end;
$$;

grant execute on function decline_invite(text) to authenticated;
