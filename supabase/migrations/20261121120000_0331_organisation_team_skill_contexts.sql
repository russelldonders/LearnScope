-- Which of the caller's own team goals and ratings belong to an organisation,
-- for the Goals and Latest skills panels on its workspace pages: those set by
-- a team in one of the organisation's workspaces. Team rows
-- (manager_skill_targets / manager_skill_ratings, context_type 'team') name
-- only their team, and members can't read workspaces, so the panels couldn't
-- tell before.
--
-- Returns only team ids the caller's own rows already point at, and only to a
-- current member of the organisation; it reveals nothing about anyone else.
-- No data changes.

create or replace function public.list_my_organisation_skill_teams(p_organisation_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct team.id
  from public.manager_teams team
  join public.workspaces workspace on workspace.id = team.workspace_id
  where workspace.organisation_id = p_organisation_id
    and (select auth.uid()) is not null
    and public.is_employer_member(p_organisation_id, (select auth.uid()))
    and team.id in (
      select target.team_id from public.manager_skill_targets target
      where target.learner_id = (select auth.uid()) and target.context_type = 'team'
      union
      select rating.team_id from public.manager_skill_ratings rating
      where rating.learner_id = (select auth.uid()) and rating.context_type = 'team'
    );
$$;

revoke all on function public.list_my_organisation_skill_teams(uuid) from public, anon;
grant execute on function public.list_my_organisation_skill_teams(uuid) to authenticated;
