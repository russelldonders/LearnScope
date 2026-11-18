-- When moderators remove a SCORM/xAPI package from sharing (0292, 0314), its
-- files are deleted too (owner's decision, 2026-11-18): they sit in the
-- public course-content bucket, so otherwise anyone already holding the
-- package's address could still open it. The owner keeps the resource's
-- record, marked as removed, but no longer the package itself.
--
-- The admin reports page deletes the files straight after the removal. These
-- policies let a platform admin list and delete exactly the folder of a
-- package that has been removed -- nothing else under learners/, and nothing
-- during a read-only impersonation session (0305 guards storage writes).

-- Whether this path lies in the folder of a package moderators removed.
-- SECURITY DEFINER to read the owner's resource; says nothing beyond that.
create or replace function public.is_removed_skill_package_path(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select split_part(p_path, '/', 1) = 'learners'
    and exists (
      select 1 from public.skill_resources r
      where r.kind in ('scorm', 'xapi')
        and r.moderation_removed_at is not null
        and r.package_path = split_part(p_path, '/', 1) || '/' || split_part(p_path, '/', 2) || '/' || split_part(p_path, '/', 3)
    )
$$;

revoke all on function public.is_removed_skill_package_path(text) from public, anon;
grant execute on function public.is_removed_skill_package_path(text) to authenticated;

create policy "Platform admins list removed skill resource packages"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'course-content'
    and (storage.foldername(storage.objects.name))[1] = 'learners'
    and public.is_platform_admin((select auth.uid()))
    and public.is_removed_skill_package_path(storage.objects.name)
  );

create policy "Platform admins delete removed skill resource packages"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'course-content'
    and (storage.foldername(storage.objects.name))[1] = 'learners'
    and public.is_platform_admin((select auth.uid()))
    and public.is_removed_skill_package_path(storage.objects.name)
  );
