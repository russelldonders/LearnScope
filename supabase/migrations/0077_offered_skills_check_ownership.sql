-- 0076's organisation_offered_skills policy only checked the offered row's
-- own organisation_id against is_org_member -- it never confirmed the
-- referenced skill_library_id is actually one that organisation is allowed
-- to offer (public, or their own provider-specific skill). A direct API
-- call with a guessed skill_library.id could otherwise roster another
-- org's provider-only skill, or someone's private personal skill, into this
-- org's offered list. skill_library's own SELECT RLS still governs whether
-- the row's contents can be read back, so this was never a live data leak,
-- but it's a real authorization-completeness gap worth closing.
drop policy "Org members and platform admins manage their organisation's offered skills" on organisation_offered_skills;

create policy "Org members and platform admins manage their organisation's offered skills"
  on organisation_offered_skills for all
  to authenticated
  using (is_platform_admin(auth.uid()) or is_org_member(organisation_id, auth.uid()))
  with check (
    (is_platform_admin(auth.uid()) or is_org_member(organisation_id, auth.uid()))
    and exists (
      select 1 from skill_library sl
      where sl.id = organisation_offered_skills.skill_library_id
        and (sl.organisation_id is null or sl.organisation_id = organisation_offered_skills.organisation_id)
    )
  );
