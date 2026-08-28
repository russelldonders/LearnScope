-- 0071 created the course-content bucket but never added storage.objects
-- policies for it (every other bucket in this schema has explicit ones --
-- 0004 avatars, 0005 skill-evidence, 0041 skill-evidence-for-validators).
-- storage.objects has RLS enabled with no matching policy default-denies,
-- so uploads/deletes were unconditionally rejected. Reads stay governed by
-- the bucket's own public=true flag (Supabase's public object endpoint
-- bypasses storage.objects RLS by design -- that's what "public" means),
-- so no SELECT policy is added here; only write/delete need one.
--
-- Authorization is derived from the literal object path's course-id folder
-- segment ((storage.foldername(name))[1]), never from
-- course_content_items.storage_path -- a row's own claimed path can't be
-- trusted to prove which folder it's actually allowed to touch.

create policy "Org members can upload content for their own editable courses"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-content'
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

create policy "Org members can remove content for their own editable courses"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'course-content'
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

-- Ties a content_items row to the storage folder it's actually allowed to
-- touch -- without this, a caller with legitimate insert/update rights on
-- their own (draft) course's row could set storage_path to a folder prefix
-- under a *different* course, and deleteContentItem's recursive walk would
-- then remove another tenant's files (the storage policies above only
-- check the real object path, not this column, so both are needed
-- together).
alter table course_content_items
  add constraint course_content_items_storage_path_scoped
  check (storage_path like course_id::text || '/%');
