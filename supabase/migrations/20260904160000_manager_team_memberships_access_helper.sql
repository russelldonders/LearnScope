-- Sixth domain-by-domain step of the additive learning-profile ownership
-- transition (see 20260904090000_learning_profile_access_helper.sql for the
-- full design rationale). Starts the "manager sharing" domain named in
-- docs/claude-account-portability-handoff.md, with the same root-table-first
-- approach already used for skills/courses/experience: convert the anchor
-- table (manager_team_memberships) now, and treat its dependents
-- (manager_team_shared_skills, manager_team_learning_activities,
-- manager_team_activity_participants, manager_collaboration_records,
-- manager_collaboration_record_members) as their own later, reviewable
-- increment -- matching how skills' own ~15 dependent tables were split from
-- the skills root table across two separate migrations.
--
-- manager_team_memberships (20260903130000_manager_team_foundation.sql) has
-- no single "owner"; member_user_id identifies which learner (or manager, for
-- their own 'manager'-role row) the membership row is about. A linked
-- account should see the same membership rows that account's own personal
-- login could already see as auth.uid() = member_user_id -- nothing more:
-- this does not change what a manager (private.can_manage_manager_team) can
-- see, and it does not let a linked account see memberships belonging to a
-- different learner.
--
-- manager_teams is deliberately NOT touched here: it belongs to the
-- manager's own workspace/workspace_access, not to a learner's personal
-- learning profile, so it is out of scope for this transition entirely (not
-- just deferred).
--
-- Checked before writing this migration: manager_team_memberships has
-- exactly one existing policy ("Managers and members can view scoped
-- memberships"), it is permissive (not restrictive), has no `using (true)`,
-- and the table already has `grant select ... to authenticated` from
-- 20260903130000_manager_team_foundation.sql, so no grant migration is
-- needed here.

create policy "Linked accounts can view accessible manager team memberships"
  on manager_team_memberships for select
  to authenticated
  using (private.can_view_learning_profile(member_user_id));
