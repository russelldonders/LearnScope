-- 0073's and 0081's storage.objects policies for course-content and
-- org-logos each run `select 1 from organisations o where o.id::text =
-- (storage.foldername(name))[1] ...` inside the policy's USING/WITH CHECK.
-- Postgres resolves that unqualified `name` against the *closest* enclosing
-- FROM clause first -- and organisations has its own `name` column (the
-- org's display name), so it silently binds to `o.name` instead of the
-- intended (correlated) `storage.objects.name`, i.e. the actual upload
-- path. `pg_policies` confirms every one of these shipped as
-- `(storage.foldername(o.name))[1]`.
--
-- An org's display name is never a valid uuid, so `o.id::text = (...)[1]`
-- can never match -- these five policies have silently rejected every
-- upload/replace/remove since the day each shipped: course-content video/
-- file/SCORM/xAPI uploads (0073) and org logo uploads (0081). Only
-- external_video resources (content_resources-only, no storage write) and
-- avatar/skill-evidence uploads (different, unaffected policies) ever
-- worked. Fix: qualify the storage object's own path column explicitly so
-- it can't be shadowed by the subquery's organisations alias.

drop policy "Org members can upload their own organisation's resources" on storage.objects;
create policy "Org members can upload their own organisation's resources"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-content'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin(auth.uid()) or is_org_member(o.id, auth.uid()))
    )
  );

drop policy "Org members can remove their own organisation's resources" on storage.objects;
create policy "Org members can remove their own organisation's resources"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'course-content'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1]
        and (is_platform_admin(auth.uid()) or is_org_member(o.id, auth.uid()))
    )
  );

drop policy "Org admins can upload their own organisation's logo" on storage.objects;
create policy "Org admins can upload their own organisation's logo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1] and is_org_admin(o.id, auth.uid())
    )
  );

drop policy "Org admins can replace their own organisation's logo" on storage.objects;
create policy "Org admins can replace their own organisation's logo"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1] and is_org_admin(o.id, auth.uid())
    )
  )
  with check (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1] and is_org_admin(o.id, auth.uid())
    )
  );

drop policy "Org admins can remove their own organisation's logo" on storage.objects;
create policy "Org admins can remove their own organisation's logo"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1] and is_org_admin(o.id, auth.uid())
    )
  );
