-- Seventh domain-by-domain step of the additive learning-profile ownership
-- transition (see 20260904090000_learning_profile_access_helper.sql for the
-- full design rationale). Converts manager_team_memberships' dependents,
-- deferred from 20260904160000_manager_team_memberships_access_helper.sql:
-- manager_team_shared_skills, manager_team_learning_activities, and
-- manager_team_activity_participants. Same shape as before: each existing
-- policy already lets the member's own login see the row through
-- member_user_id = auth.uid() (directly, or via a manager_team_memberships
-- join); each new policy is the same check with
-- private.can_view_learning_profile(member_user_id) substituted in, so a
-- linked account sees exactly what the member's own login could already
-- see, no more.
--
-- manager_collaboration_records and manager_collaboration_record_members are
-- deliberately NOT included, and not merely deferred: unlike every other
-- table in this domain, their only existing policies gate on
-- private.can_manage_manager_team (manager-only) -- a team member's own
-- login has no visibility into them today, so there is no member-level
-- access for a linked account to extend. They are manager-authored content
-- about the team, not the learner's own learning-profile content, matching
-- why manager_teams itself was excluded from the root-table migration.
--
-- Checked before writing this migration: all three converted tables have
-- exactly one existing policy each, every one permissive (not restrictive),
-- none with `using (true)`, and all three already have `grant select ... to
-- authenticated` from 20260903130000_manager_team_foundation.sql -- no grant
-- migration needed.

create policy "Linked accounts can view accessible shared skill links"
  on manager_team_shared_skills for select
  to authenticated
  using (
    exists (
      select 1
      from public.manager_team_memberships m
      where m.id = membership_id
        and private.can_view_learning_profile(m.member_user_id)
    )
  );

create policy "Linked accounts can view accessible collaborative activities"
  on manager_team_learning_activities for select
  to authenticated
  using (
    exists (
      select 1
      from public.manager_team_memberships m
      where m.team_id = manager_team_learning_activities.team_id
        and m.status = 'active'
        and private.can_view_learning_profile(m.member_user_id)
    )
  );

create policy "Linked accounts can view accessible team activity invitations"
  on manager_team_activity_participants for select
  to authenticated
  using (
    exists (
      select 1
      from public.manager_team_memberships m
      join public.manager_team_learning_activities a on a.team_id = m.team_id
      where m.id = membership_id
        and a.id = activity_id
        and private.can_view_learning_profile(m.member_user_id)
    )
  );
