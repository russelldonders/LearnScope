-- Eleventh domain-by-domain step of the additive learning-profile ownership
-- transition (see 20260904090000_learning_profile_access_helper.sql for the
-- full design rationale). Converts profile_searchable_skills, profile_share_
-- links, and profile_share_link_skills, deferred from the skills-dependents
-- increment as "different access semantics" pending review -- reviewed now:
--
-- profile_searchable_skills (0058_skill_discovery_and_connections.sql,
-- profile_id) is single-owner, same shape as skills/courses/experience.
--
-- profile_share_links (20260902300000_profile_share_links.sql, user_id) is
-- also single-owner. Its only existing SELECT policy ("Learners can view
-- their own share links") is the *owner's own management view* of the links
-- they've created -- the separate public/anonymous consumption path (the
-- /providers/:slug-style token flow) goes through its own SECURITY DEFINER
-- RPCs keyed by token, not this policy, so converting this table does not
-- touch anonymous access at all. profile_share_link_skills is a dependent,
-- joining via share_link_id, same pattern as employer_data_access_shared_
-- skills joining via request_id.
--
-- Correction to this transition's own record: an earlier increment's
-- "Deliberately NOT included" note grouped profile_share_links together with
-- employer_members/organisation_members as "membership and account-setting
-- records, not learning-profile content". Direct inspection here shows that
-- categorization doesn't hold for profile_share_links: unlike those
-- membership tables, it has no admin/role semantics at all -- it is the
-- learner's own created records about their own profile, structurally
-- identical to connection_invites (already converted). employer_members/
-- organisation_members remain correctly out of scope; profile_share_links
-- does not belong in that group.
--
-- parent/child experience links (docs/claude-account-portability-handoff.md's
-- "Define domain-specific execution rules" inventory) need no migration of
-- their own: parent_experience_id is a plain self-referential column on
-- experience, not a separate table, and experience itself was already
-- converted in 20260904110000_courses_experience_access_helper.sql -- a
-- linked account that can see a row via that policy already sees its
-- parent_experience_id column along with everything else on the row.
--
-- Checked before writing this migration: all three tables have exactly the
-- one existing SELECT policy each already quoted above, all permissive (not
-- restrictive), none with `using (true)`. None of the three has `grant
-- select ... to authenticated` in any migration -- confirmed via
-- information_schema.role_table_grants against a fresh local reset --
-- so 20260904211500_grant_searchable_and_share_link_skills_select.sql adds
-- all three, the sixth through eighth instances of the same local/Staging
-- ambient-ACL divergence documented in earlier migrations of this
-- transition.

create policy "Linked accounts can view accessible searchable-skills entries"
  on profile_searchable_skills for select
  to authenticated
  using (private.can_view_learning_profile(profile_id));

create policy "Linked accounts can view accessible share links"
  on profile_share_links for select
  to authenticated
  using (private.can_view_learning_profile(user_id));

create policy "Linked accounts can view accessible share link skills"
  on profile_share_link_skills for select
  to authenticated
  using (
    exists (
      select 1
      from public.profile_share_links l
      where l.id = share_link_id
        and private.can_view_learning_profile(l.user_id)
    )
  );
