-- Course cover image, overtaking CourseThumbnail's generated gradient
-- placeholder once set. Distinct from organisations.logo_url (0081), which
-- is a small provider badge, not the course's own image.
alter table course_catalogue add column image_url text;

insert into storage.buckets (id, name, public)
values ('course-catalogue-images', 'course-catalogue-images', true)
on conflict (id) do nothing;

-- No SELECT policy, matching the course-content bucket (0072) rather than
-- org-logos (0081): the bucket's public=true flag already serves images via
-- an unauthenticated GET that bypasses storage.objects RLS entirely, so a
-- SELECT policy here would only ever grant *listing* the bucket's contents
-- -- a capability nothing in this feature needs.
--
-- Write access mirrors 0072's course-content bucket exactly: an
-- organisation member may upload/replace/remove their own course's image
-- while it's draft/rejected (the same window course_catalogue's own update
-- policy allows them to edit the rest of the course in), or a platform
-- admin at any status. Authorization is derived from the literal object
-- path's course-id folder segment, not from course_catalogue.image_url --
-- a row's own claimed URL can't be trusted to prove which folder it's
-- actually allowed to touch.
create policy "Course editors can upload their course's image"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-catalogue-images'
    and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(name))[1]
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

create policy "Course editors can replace their course's image"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'course-catalogue-images'
    and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(name))[1]
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
    bucket_id = 'course-catalogue-images'
    and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(name))[1]
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

create policy "Course editors can remove their course's image"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'course-catalogue-images'
    and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(name))[1]
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
