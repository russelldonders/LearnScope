-- Lets an active team member see who else is on their manager team, once
-- they've accepted an invite -- today only the manager can see the roster
-- (list_manager_team_member_summaries), because that view also projects each
-- member's skills shared with the manager, which members never consented to
-- show teammates. This roster carries no skill/evidence data at all, just
-- who's on the team and their role, so it's safe for every active
-- participant (manager or member) to read.

create or replace function list_manager_team_roster(p_team_id uuid)
returns table (id uuid, name text, avatar_url text, role text, member_since timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    coalesce(nullif(trim(p.full_name), ''), 'Team member'),
    p.avatar_url,
    m.role,
    coalesce(m.decided_at, m.invited_at)
  from public.manager_team_memberships m
  join public.profiles p on p.id = m.member_user_id
  where m.team_id = p_team_id and m.status = 'active'
    and exists (
      select 1 from public.manager_team_memberships me
      where me.team_id = p_team_id and me.member_user_id = auth.uid() and me.status = 'active'
    )
  order by (m.role = 'manager') desc, p.full_name nulls last, m.invited_at
$$;

revoke all on function list_manager_team_roster(uuid) from public, anon;
grant execute on function list_manager_team_roster(uuid) to authenticated;
