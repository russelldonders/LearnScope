-- Named, ordered groups of content within one course_catalogue entry --
-- content_resources/course_content_links (0073) stay flat and reusable
-- across courses; a section only groups how one specific course presents
-- its links, so section ownership follows the course, not the resource.
-- Nothing in the schema grouped course content before this (course_
-- content_links.position was a single flat counter per course) -- this is
-- the provider-facing course editor's new structuring concept.
create table course_sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references course_catalogue(id) on delete cascade not null,
  title text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index course_sections_course_id_idx on course_sections (course_id);

alter table course_content_links add column section_id uuid references course_sections(id) on delete set null;
create index course_content_links_section_id_idx on course_content_links (section_id);

-- Backfill: every course that already has content gets one "General"
-- section so existing links stay visible/grouped once the editor UI
-- expects every item to belong to a section, rather than becoming silently
-- orphaned. Existing course_content_links.position values were already
-- sequential per course, so relative order is preserved unchanged inside
-- this one bucket.
insert into course_sections (course_id, title, position)
select distinct course_id, 'General', 0
from course_content_links;

update course_content_links ccl
set section_id = cs.id
from course_sections cs
where cs.course_id = ccl.course_id and cs.position = 0 and cs.title = 'General';

alter table course_sections enable row level security;

-- Same visibility rule as course_content_links/content_resources: a
-- section is viewable wherever its course is (approved and public,
-- platform admin, or the owning org's own members).
create policy "View sections for viewable courses"
  on course_sections for select
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_sections.course_id
        and (
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
        )
    )
  );

-- Same manage rule as course_catalogue's own org-members update policy
-- (0066): only while the course is still draft/rejected.
create policy "Org members manage sections for their own editable courses"
  on course_sections for all
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_sections.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  )
  with check (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_sections.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  );

-- Extends 0074's course_content_links manage policy (unchanged `using`) with
-- one more `with check` condition: a link's section_id, if set, must belong
-- to the same course_id it's linked into -- otherwise an org admin could
-- point a link at a section from an entirely different course, corrupting
-- that other course's structure even though resource/course ownership
-- checks both still pass individually.
drop policy "Org members manage links for their own editable courses" on course_content_links;

create policy "Org members manage links for their own editable courses"
  on course_content_links for all
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_links.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
    and can_manage_content_resource(course_content_links.resource_id, auth.uid())
  )
  with check (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_links.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
    and can_manage_content_resource(course_content_links.resource_id, auth.uid())
    and (
      course_content_links.section_id is null
      or exists (
        select 1 from course_sections cs
        where cs.id = course_content_links.section_id and cs.course_id = course_content_links.course_id
      )
    )
  );
