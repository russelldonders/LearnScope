-- 0093's policies accidentally bind `name` to course_catalogue.name instead
-- of the storage object's path, so every UUID-folder check fails.

drop policy "Course editors can upload their course's image" on storage.objects;
create policy "Course editors can upload their course's image"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'course-catalogue-images' and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin((select auth.uid())) or (
          cc.organisation_id is not null
          and is_org_member(cc.organisation_id, (select auth.uid()))
          and cc.status in ('draft', 'rejected')
        ))
    )
  );

drop policy "Course editors can replace their course's image" on storage.objects;
create policy "Course editors can replace their course's image"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'course-catalogue-images' and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin((select auth.uid())) or (
          cc.organisation_id is not null
          and is_org_member(cc.organisation_id, (select auth.uid()))
          and cc.status in ('draft', 'rejected')
        ))
    )
  )
  with check (
    bucket_id = 'course-catalogue-images' and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin((select auth.uid())) or (
          cc.organisation_id is not null
          and is_org_member(cc.organisation_id, (select auth.uid()))
          and cc.status in ('draft', 'rejected')
        ))
    )
  );

-- Storage upsert also performs a SELECT before UPDATE. Keep that SELECT
-- path-scoped to editors; the public object endpoint remains unaffected.
create policy "Course editors can read their course image object for replacement"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'course-catalogue-images' and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin((select auth.uid())) or (
          cc.organisation_id is not null
          and is_org_member(cc.organisation_id, (select auth.uid()))
          and cc.status in ('draft', 'rejected')
        ))
    )
  );

drop policy "Course editors can remove their course's image" on storage.objects;
create policy "Course editors can remove their course's image"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'course-catalogue-images' and exists (
      select 1 from course_catalogue cc
      where cc.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin((select auth.uid())) or (
          cc.organisation_id is not null
          and is_org_member(cc.organisation_id, (select auth.uid()))
          and cc.status in ('draft', 'rejected')
        ))
    )
  );
