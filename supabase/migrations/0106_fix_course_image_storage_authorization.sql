-- 0097 still bound the path expression inside its course_catalogue
-- subquery to course_catalogue.name. Pass the storage object path into a
-- bounded helper instead, so PostgreSQL cannot rebind the outer name.

create or replace function can_manage_course_catalogue_image(object_path text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from course_catalogue cc
    where cc.id::text = (storage.foldername(object_path))[1]
      and (
        is_platform_admin((select auth.uid()))
        or (
          cc.organisation_id is not null
          and is_org_member(cc.organisation_id, (select auth.uid()))
          and cc.status in ('draft', 'rejected')
        )
      )
  )
$$;

revoke all on function can_manage_course_catalogue_image(text) from public;
grant execute on function can_manage_course_catalogue_image(text) to authenticated;

drop policy if exists "Course editors can upload their course's image" on storage.objects;
create policy "Course editors can upload their course's image"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-catalogue-images'
    and can_manage_course_catalogue_image(name)
  );

drop policy if exists "Course editors can replace their course's image" on storage.objects;
create policy "Course editors can replace their course's image"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'course-catalogue-images'
    and can_manage_course_catalogue_image(name)
  )
  with check (
    bucket_id = 'course-catalogue-images'
    and can_manage_course_catalogue_image(name)
  );

drop policy if exists "Course editors can read their course image object for replacement" on storage.objects;
create policy "Course editors can read their course image object for replacement"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'course-catalogue-images'
    and can_manage_course_catalogue_image(name)
  );

drop policy if exists "Course editors can remove their course's image" on storage.objects;
create policy "Course editors can remove their course's image"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'course-catalogue-images'
    and can_manage_course_catalogue_image(name)
  );
