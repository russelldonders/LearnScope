-- "Invite by email" used to require the address already belong to an
-- existing LearnScope account the leader was already connected to --
-- effectively just a second way to add an existing connection, not a real
-- invite. This lets the leader genuinely recruit someone with no account
-- yet: api/admin/actions.js's new inviteManagerTeamMemberByEmail action
-- (mirroring inviteOrgStaff there) uses the Supabase Auth admin API to
-- create their account and send the real sign-up email, which requires the
-- service-role key and so can't run as a plain client-callable RPC.
--
-- is_manager_team_leader is a thin public wrapper around the already-
-- existing private.can_manage_manager_team, taking the caller explicitly as
-- a parameter rather than reading auth.uid() -- that serverless action runs
-- under the service-role key with no user JWT, so auth.uid() would be null
-- there. Never used by anything except that one server-side authorization
-- check.
create or replace function public.is_manager_team_leader(p_team_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_manage_manager_team(p_team_id, p_user_id)
$$;

revoke all on function public.is_manager_team_leader(uuid, uuid) from public, anon;
grant execute on function public.is_manager_team_leader(uuid, uuid) to authenticated;

-- Superseded by the serverless action above, which handles both an
-- existing account and a brand-new one; nothing in the client calls this
-- connection-gated version any more.
drop function if exists public.invite_connection_to_manager_team_by_email(uuid, text);
