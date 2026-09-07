-- Lets the Connections list show, per connection tile, any manager team the
-- current user and that connection are both part of -- plus teams the
-- current user has invited them to that are still pending.
--
-- Needed as a SECURITY DEFINER RPC rather than a plain client query: RLS on
-- manager_team_memberships ("member_user_id = auth.uid() OR
-- private.can_manage_manager_team(...)", see 20260903130000) only lets a
-- caller see their own membership rows, plus every row for a team they
-- manage. It deliberately does NOT let a plain member of team X see who
-- else is in team X if they don't manage it -- so cross-referencing that
-- against the caller's connections has to happen server-side.
--
-- Visibility rules enforced below:
-- * The caller must themselves have an active membership in the team
--   (mine.status = 'active') before anything about it is returned.
-- * A connection's *active* membership in a shared team is visible to any
--   fellow active member (you're already both genuinely on the team).
-- * A connection's *pending* invite is only visible if the caller manages
--   that team -- i.e. only the person who could have sent the invite sees
--   it as "still pending", never a third member.
create or replace function list_my_shared_teams_by_connection()
returns table (connection_user_id uuid, team_id uuid, team_name text, team_status text, membership_status text)
language sql stable security definer set search_path = '' as $$
  select other.member_user_id, mt.id, mt.name, mt.status, other.status
  from public.manager_team_memberships mine
  join public.manager_teams mt on mt.id = mine.team_id
  join public.manager_team_memberships other on other.team_id = mine.team_id
    and other.member_user_id <> auth.uid()
  join public.connections c on
    c.user_a_id = least(auth.uid(), other.member_user_id)
    and c.user_b_id = greatest(auth.uid(), other.member_user_id)
  where mine.member_user_id = auth.uid() and mine.status = 'active'
    and (
      other.status = 'active'
      or (other.status = 'pending' and private.can_manage_manager_team(mine.team_id, auth.uid()))
    )
$$;

revoke all on function list_my_shared_teams_by_connection() from public, anon;
grant execute on function list_my_shared_teams_by_connection() to authenticated;
