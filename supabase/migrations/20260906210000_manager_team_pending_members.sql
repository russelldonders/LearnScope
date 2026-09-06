-- Lets a team leader see who they've invited but hasn't accepted yet (they
-- were previously invisible on the Members tab -- only list_manager_team_
-- member_summaries's role='member' and status='active' rows ever showed up
-- there) and revoke a still-pending invitation. Revoking reuses the existing
-- 'removed' status (already a valid manager_team_memberships.status value,
-- and already what makes a person re-inviteable in invite_connection_to_
-- manager_team's on-conflict clause) rather than deleting the row.

create or replace function public.list_manager_team_pending_members(p_team_id uuid)
returns table (id uuid, name text, avatar_url text, invited_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.id, coalesce(nullif(trim(p.full_name), ''), 'Invited'), p.avatar_url, m.invited_at
  from public.manager_team_memberships m
  join public.profiles p on p.id = m.member_user_id
  where m.team_id = p_team_id and m.role = 'member' and m.status = 'pending'
    and private.can_manage_manager_team(p_team_id, auth.uid())
  order by m.invited_at desc
$$;

create or replace function public.revoke_manager_team_invite(p_membership_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_team_id uuid;
begin
  select team_id into v_team_id from public.manager_team_memberships
  where id = p_membership_id and role = 'member' and status = 'pending'
  for update;
  if v_team_id is null then raise exception 'Pending invitation not found'; end if;
  if not private.can_manage_manager_team(v_team_id, auth.uid()) then raise exception 'Not authorised'; end if;
  if not exists (select 1 from public.manager_teams where id = v_team_id and status = 'active') then
    raise exception 'This team has been archived and can no longer be changed';
  end if;
  update public.manager_team_memberships set status = 'removed', decided_at = now() where id = p_membership_id;
end $$;

revoke all on function public.list_manager_team_pending_members(uuid), public.revoke_manager_team_invite(uuid) from public, anon;
grant execute on function public.list_manager_team_pending_members(uuid), public.revoke_manager_team_invite(uuid) to authenticated;
