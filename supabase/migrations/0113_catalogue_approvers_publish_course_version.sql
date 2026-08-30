-- 0107 (course versioning, merged from staging after this branch's 0112
-- catalogue_approvers was written) introduced publish_course_version and
-- routed the app's only "approve"/"reactivate" action
-- (approveCatalogueCourse, src/lib/admin/catalogue.js) through it instead of
-- a plain table update. That function's authorization check is hardcoded to
-- is_platform_admin only, so a designated catalogue approver (0112) would
-- hit "Not authorized" trying to approve/reactivate their own org's
-- course -- 0112's course_catalogue RLS policies were never actually
-- reachable through the app for that action. This re-defines the function
-- to also authorize a catalogue approver for the course's own organisation,
-- matching is_catalogue_approver's own current-org-only scope; platform
-- admin behaviour is unchanged.
create or replace function publish_course_version(p_course_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_group_id uuid;
  v_org_id uuid;
begin
  select version_group_id, organisation_id into v_group_id, v_org_id
  from course_catalogue
  where id = p_course_id
  for update;

  if v_group_id is null then
    raise exception 'Course not found';
  end if;

  if not (
    is_platform_admin((select auth.uid()))
    or (v_org_id is not null and is_catalogue_approver(v_org_id, (select auth.uid())))
  ) then
    raise exception 'Not authorized';
  end if;

  update course_catalogue
  set status = 'inactive', is_current_published = false
  where version_group_id = v_group_id
    and is_current_published
    and id <> p_course_id;

  update course_catalogue
  set status = 'approved',
      is_current_published = true,
      approved_by = (select auth.uid()),
      approved_at = now(),
      rejection_reason = null
  where id = p_course_id;
end;
$$;
