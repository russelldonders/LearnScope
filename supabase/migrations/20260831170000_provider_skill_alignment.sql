-- Provider-managed alignment between an offered skill and the organisation's
-- reusable resources. The resource remains the source record; removing an
-- alignment only removes this association.
create table content_resource_skills (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references content_resources(id) on delete cascade,
  skill_library_id uuid not null references skill_library(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (resource_id, skill_library_id)
);

create index content_resource_skills_resource_idx on content_resource_skills (resource_id);
create index content_resource_skills_skill_idx on content_resource_skills (skill_library_id);

alter table content_resource_skills enable row level security;

revoke all on table content_resource_skills from anon, authenticated;
grant select, insert, delete on table content_resource_skills to authenticated;

create policy "Org members and platform admins view resource skill alignments"
  on content_resource_skills for select
  to authenticated
  using (
    is_platform_admin((select auth.uid()))
    or exists (
      select 1
      from content_resources cr
      where cr.id = content_resource_skills.resource_id
        and is_org_member(cr.organisation_id, (select auth.uid()))
    )
  );

create policy "Org members align their resources to offered skills"
  on content_resource_skills for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from content_resources cr
      join organisation_offered_skills oos
        on oos.organisation_id = cr.organisation_id
       and oos.skill_library_id = content_resource_skills.skill_library_id
      where cr.id = content_resource_skills.resource_id
        and is_org_member(cr.organisation_id, (select auth.uid()))
    )
  );

create policy "Org members remove their resource skill alignments"
  on content_resource_skills for delete
  to authenticated
  using (
    is_platform_admin((select auth.uid()))
    or exists (
      select 1
      from content_resources cr
      where cr.id = content_resource_skills.resource_id
        and is_org_member(cr.organisation_id, (select auth.uid()))
    )
  );

-- course_catalogue_skills is the existing source of truth for which skills a
-- course targets. Providers may manage those rows only for editable courses
-- owned by one of their organisations, and only for skills on that
-- organisation's offered-skills roster.
grant insert, update, delete on table course_catalogue_skills to authenticated;

create policy "Org members add offered skills to editable training"
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
        and cc.status in ('draft', 'rejected')
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  );

create policy "Org members update offered skills on editable training"
  on course_catalogue_skills for update
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_catalogue_skills.course_catalogue_id
        and cc.status in ('draft', 'rejected')
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
        and cc.status in ('draft', 'rejected')
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  );

create policy "Org members remove skills from editable training"
  on course_catalogue_skills for delete
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_catalogue_skills.course_catalogue_id
        and cc.status in ('draft', 'rejected')
        and is_org_member(cc.organisation_id, (select auth.uid()))
    )
  );
