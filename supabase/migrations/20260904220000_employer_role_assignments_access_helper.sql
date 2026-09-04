-- Twelfth domain-by-domain step of the additive learning-profile ownership
-- transition (see 20260904090000_learning_profile_access_helper.sql for the
-- full design rationale). Converts employer_role_assignments
-- (20260903170000_employer_role_profiles.sql), previously deferred as a
-- "materially different, mutual-consent" shape -- full re-review here shows
-- it actually splits cleanly into two independent pieces:
--
-- - employer_role_profiles, employer_role_profile_skills, and employer_role_
--   profile_training have NO learner-owned column at all: they are the
--   employer's own role templates (name, skill/training requirements),
--   visible only to active employer members via private.can_view_employer_
--   role_profile / is_employer_admin. created_by is an audit field (who at
--   the employer created it), not row ownership. These stay permanently out
--   of scope for this transition -- not deferred -- same reasoning that
--   already excluded manager_teams: employer-side content, not a learner's
--   own learning-profile content.
-- - employer_role_assignments (this migration) has exactly one existing
--   SELECT policy: "Employers and assigned learners can view role
--   assignments", visible to the specific assigned learner (em.user_id =
--   auth.uid(), joined via employer_member_id -> employer_members.user_id)
--   or any employer admin. The additive policy below extends only the
--   learner's own side, mirroring exactly what that learner's own login
--   already sees; it does not change an employer admin's own
--   is_employer_admin-gated visibility.
--
-- Unlike every prior dependent-table conversion in this transition (e.g.
-- manager_team_shared_skills via manager_team_memberships,
-- employer_data_access_shared_skills via employer_data_access_requests),
-- the table this joins through -- employer_members -- is NOT itself being
-- converted (per the point above, it stays out of scope). A naive subquery
-- against employer_members would be evaluated under the *caller's own* RLS
-- (employer_members' policies only cover "is an employer member/admin of
-- this employer" or "auth.uid() = user_id", neither of which covers a
-- linked account acting for a different auth.uid()), so it would silently
-- see zero rows and deny access even with a valid link and grant -- caught
-- by the SQL allow/deny test below before commit. Fixed the same way
-- learning_profiles/workspaces' own equivalent problem was fixed in
-- 20260904090000_learning_profile_access_helper.sql: a narrow, explicit
-- SECURITY DEFINER helper that resolves employer_member_id to its user_id,
-- bypassing employer_members' RLS for exactly this one lookup, without
-- exposing employer_members itself any more broadly.

create or replace function private.employer_member_user_id(p_employer_member_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select em.user_id
  from public.employer_members em
  where em.id = p_employer_member_id
$$;

-- Unlike private.personal_workspace_owner_account (only ever called from
-- inside another SECURITY DEFINER function's body, so authenticated never
-- needs direct execute on it), this function is called directly from the
-- policy's USING clause below, which runs as the querying role -- so
-- authenticated needs explicit execute here.
revoke all on function private.employer_member_user_id(uuid) from public, anon;
grant execute on function private.employer_member_user_id(uuid) to authenticated;

create policy "Linked accounts can view accessible role assignments"
  on public.employer_role_assignments for select
  to authenticated
  using (
    private.can_view_learning_profile(
      private.employer_member_user_id(employer_member_id)
    )
  );
