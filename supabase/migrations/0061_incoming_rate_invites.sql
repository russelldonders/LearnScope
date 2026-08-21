-- Surfaces pending rate invites addressed to the current user's own email,
-- for the Connections page -- today connection_invites' only SELECT policy
-- is "Inviters can view their own invites" (0010), so an invitee has no way
-- to see an invite sent to them until they already have the share_code (the
-- same gap get_invite_preview/accept_invite_and_rate already work around
-- for the one-invite-you-already-have-a-link-for case). SECURITY DEFINER,
-- scoped tightly to rows whose invitee_email matches the caller's own
-- verified email -- nothing here is data the caller couldn't already see if
-- they simply opened the invite link themselves.
create or replace function list_incoming_rate_invites()
returns table (
  id uuid,
  inviter_id uuid,
  inviter_name text,
  skill_id uuid,
  skill_name text,
  skill_category text,
  share_code text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select ci.id, ci.inviter_id, p.full_name, ci.skill_id, s.name, s.category, ci.share_code, ci.created_at
  from connection_invites ci
  join skills s on s.id = ci.skill_id
  left join profiles p on p.id = ci.inviter_id
  where ci.status = 'pending'
    and ci.invitee_email is not null
    and lower(ci.invitee_email) = lower((select email from auth.users where id = auth.uid()))
  order by ci.created_at desc
$$;

grant execute on function list_incoming_rate_invites() to authenticated;
