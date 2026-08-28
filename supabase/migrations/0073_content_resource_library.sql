-- Content (video/file/SCORM) moves from "belongs to one course" to "belongs
-- to an organisation, reusable across courses" -- a provider uploads a
-- resource once into their org's library, then attaches (links) it to
-- however many courses need it, rather than re-uploading the same file per
-- course. course_content_items becomes content_resources (organisation-
-- scoped); course_content_links is the new many-to-many attachment, with
-- its own per-course ordering (a resource's position makes sense only in
-- the context of a specific course, so it moves off the resource itself and
-- onto the link).

alter table course_content_items rename to content_resources;

alter table content_resources add column organisation_id uuid references organisations(id) on delete cascade;

update content_resources cr
set organisation_id = cc.organisation_id
from course_catalogue cc
where cc.id = cr.course_id;

-- Every content_resources row so far was created through a course that
-- always had an organisation_id (0066's insert policy requires it) -- this
-- should be a no-op verification, not an actual backfill gap.
alter table content_resources alter column organisation_id set not null;

create table course_content_links (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references course_catalogue(id) on delete cascade not null,
  resource_id uuid references content_resources(id) on delete cascade not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (course_id, resource_id)
);

insert into course_content_links (course_id, resource_id, position)
select course_id, id, position from content_resources where course_id is not null;

create index course_content_links_course_id_idx on course_content_links (course_id);
create index course_content_links_resource_id_idx on course_content_links (resource_id);

-- Must drop before dropping course_id -- both old policies reference it.
drop policy "View content for viewable courses" on content_resources;
drop policy "Manage content for editable courses" on content_resources;

alter table content_resources drop constraint course_content_items_storage_path_scoped;
alter table content_resources drop column course_id;
alter table content_resources drop column position;

-- Storage folders are now namespaced by organisation_id, not course_id (see
-- storage.objects policies below).
alter table content_resources
  add constraint content_resources_storage_path_scoped
  check (storage_path like organisation_id::text || '/%');

create index content_resources_organisation_id_idx on content_resources (organisation_id);

alter table course_content_links enable row level security;

-- A resource is visible to its own org (any member), a platform admin, or
-- anyone if it's actually linked into at least one approved course --
-- mirrors course_catalogue's own "approved is public" rule, just derived
-- through the link table since a resource has no status of its own.
create policy "View own org's resources, or linked into an approved course"
  on content_resources for select
  to authenticated
  using (
    is_platform_admin(auth.uid())
    or is_org_member(organisation_id, auth.uid())
    or exists (
      select 1 from course_content_links ccl
      join course_catalogue cc on cc.id = ccl.course_id
      where ccl.resource_id = content_resources.id and cc.status = 'approved'
    )
  );

-- Resources aren't tied to one course's draft/rejected edit window anymore
-- -- any active member of the owning org can manage the library itself
-- (is_org_member already requires organisations.status = 'active', 0069).
create policy "Org members manage their own organisation's resources"
  on content_resources for all
  to authenticated
  using (is_platform_admin(auth.uid()) or is_org_member(organisation_id, auth.uid()))
  with check (is_platform_admin(auth.uid()) or is_org_member(organisation_id, auth.uid()));

create policy "View links for viewable courses"
  on course_content_links for select
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_links.course_id
        and (
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
        )
    )
  );

-- Attaching/detaching a resource requires BOTH: the course is one of the
-- caller's own, still editable (draft/rejected), AND the resource being
-- linked actually belongs to an org the caller is a member of -- otherwise
-- an org admin could attach another organisation's private resource into
-- their own course.
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
    and exists (
      select 1 from content_resources cr
      where cr.id = course_content_links.resource_id
        and (is_platform_admin(auth.uid()) or is_org_member(cr.organisation_id, auth.uid()))
    )
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
    and exists (
      select 1 from content_resources cr
      where cr.id = course_content_links.resource_id
        and (is_platform_admin(auth.uid()) or is_org_member(cr.organisation_id, auth.uid()))
    )
  );

-- Storage RLS (0072) checked the object path's first folder segment against
-- course_catalogue; resources (and their storage folders) now belong
-- directly to an organisation, so check that directly -- simpler, and no
-- longer depends on any particular course existing/being editable.
drop policy "Org members can upload content for their own editable courses" on storage.objects;
drop policy "Org members can remove content for their own editable courses" on storage.objects;

-- Matches the folder segment as text against organisations.id::text, rather
-- than casting the (arbitrary, attacker-influenceable) path segment to
-- uuid directly -- SQL's AND doesn't guarantee left-to-right short-circuit
-- evaluation, so a direct `(storage.foldername(name))[1]::uuid` could throw
-- mid-evaluation for any malformed path on this table (any bucket, not just
-- this one), regardless of the bucket_id check placed "before" it. A text
-- comparison can't throw.
create policy "Org members can upload their own organisation's resources"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-content'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(name))[1]
        and (is_platform_admin(auth.uid()) or is_org_member(o.id, auth.uid()))
    )
  );

create policy "Org members can remove their own organisation's resources"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'course-content'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(name))[1]
        and (is_platform_admin(auth.uid()) or is_org_member(o.id, auth.uid()))
    )
  );
