-- Provider-admin participant reporting for catalogue courses.

create index if not exists courses_catalogue_course_created_at_idx
  on courses (catalogue_course_id, created_at)
  where catalogue_course_id is not null;

create index if not exists course_content_progress_content_item_user_idx
  on course_content_progress (content_item_id, user_id);

-- Keep course/progress policies out of course_catalogue's own RLS graph:
-- its learner visibility policy refers back to courses, so a direct lookup
-- here would recurse. This bounded helper only answers an authorization
-- question and follows the project's existing is_org_admin helper pattern.
create or replace function is_course_provider_admin(check_course_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from course_catalogue cc
    where cc.id = check_course_id
      and cc.organisation_id is not null
      and is_org_admin(cc.organisation_id, check_user_id)
  )
$$;

revoke all on function is_course_provider_admin(uuid, uuid) from public;
grant execute on function is_course_provider_admin(uuid, uuid) to authenticated;

drop policy if exists "Provider admins can view their course participants" on courses;
create policy "Provider admins can view their course participants"
  on courses for select
  to authenticated
  using (
    catalogue_course_id is not null
    and is_course_provider_admin(catalogue_course_id, (select auth.uid()))
  );

drop policy if exists "Provider admins can view participant progress" on course_content_progress;
create policy "Provider admins can view participant progress"
  on course_content_progress for select
  to authenticated
  using (
    exists (
      select 1
      from course_content_links ccl
      where ccl.resource_id = course_content_progress.content_item_id
        and is_course_provider_admin(ccl.course_id, (select auth.uid()))
    )
  );
