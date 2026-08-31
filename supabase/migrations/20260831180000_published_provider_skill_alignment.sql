-- Skill alignment is catalogue metadata managed from the provider skill
-- workspace. Providers choose from current published training rather than
-- editing course content, so allow alignment rows on the current approved
-- version while keeping all course fields and publication state protected by
-- course_catalogue's existing policies.
drop policy "Org members add offered skills to editable training" on course_catalogue_skills;
drop policy "Org members update offered skills on editable training" on course_catalogue_skills;
drop policy "Org members remove skills from editable training" on course_catalogue_skills;

create policy "Org members add offered skills to published training"
  on course_catalogue_skills for insert
  to authenticated
  with check (
    exists (
      select 1
      from course_catalogue cc
      join organisation_offered_skills oos
        on oos.organisation_id = cc.organisation_id
       and oos.skill_library_id = course_catalogue_skills.skill_library_id
      where cc.id = course_catalogue_skills.course_catalogue_id
        and cc.status = 'approved'
        and cc.is_current_published
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  );

create policy "Org members update offered skills on published training"
  on course_catalogue_skills for update
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_catalogue_skills.course_catalogue_id
        and cc.status = 'approved'
        and cc.is_current_published
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1
      from course_catalogue cc
      join organisation_offered_skills oos
        on oos.organisation_id = cc.organisation_id
       and oos.skill_library_id = course_catalogue_skills.skill_library_id
      where cc.id = course_catalogue_skills.course_catalogue_id
        and cc.status = 'approved'
        and cc.is_current_published
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  );

create policy "Org members remove skills from published training"
  on course_catalogue_skills for delete
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_catalogue_skills.course_catalogue_id
        and cc.status = 'approved'
        and cc.is_current_published
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  );
