-- Separate "publish" (make this version the org's current live version)
-- from "push to catalogue" (make it discoverable through a specific
-- catalogue, which already has its own approval gate). A course version
-- with no catalogue selected is never distributed anywhere outside its own
-- organisation -- learner browsing (listCatalogueCourses) only surfaces
-- rows with a published course_catalogue_publications entry, so there is
-- no external party who needs to sign off on a catalogue-less publish.
-- Pushing an already-published version into a catalogue afterwards
-- remains the separate assign_course_to_catalogue step (20260831121500
-- onward), unchanged by this migration.

create or replace function submit_course_for_publication(p_course_id uuid, p_catalogue_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_organisation_id uuid;
  v_group_id uuid;
  v_catalogue_ids uuid[] := coalesce(p_catalogue_ids, '{}');
begin
  select organisation_id, version_group_id into v_organisation_id, v_group_id
  from course_catalogue
  where id = p_course_id
    and status in ('draft', 'rejected')
  for update;

  if v_organisation_id is null then
    raise exception 'Course is not editable or does not belong to a provider';
  end if;

  if not (
    is_platform_admin(v_caller)
    or is_org_member(v_organisation_id, v_caller)
  ) then
    raise exception 'Not authorized';
  end if;

  if cardinality(v_catalogue_ids) = 0 then
    update course_catalogue
    set status = 'inactive', is_current_published = false
    where version_group_id = v_group_id
      and is_current_published
      and id <> p_course_id;

    update course_catalogue
    set status = 'approved',
        is_current_published = true,
        approved_by = v_caller,
        approved_at = now(),
        rejection_reason = null
    where id = p_course_id;

    delete from course_catalogue_publications where course_id = p_course_id;
    return;
  end if;

  if exists (
    select 1
    from unnest(v_catalogue_ids) selected_id
    left join catalogues c
      on c.id = selected_id
      and (c.is_global or c.organisation_id = v_organisation_id)
    where c.id is null
  ) then
    raise exception 'One or more catalogues are not available to this provider';
  end if;

  delete from course_catalogue_publications where course_id = p_course_id;

  insert into course_catalogue_publications (course_id, catalogue_id, selected_by)
  select p_course_id, selected_id, v_caller
  from (select distinct unnest(v_catalogue_ids) as selected_id) selected;

  update course_catalogue
  set status = 'pending_approval', rejection_reason = null
  where id = p_course_id;
end;
$$;

revoke all on function submit_course_for_publication(uuid, uuid[]) from public;
grant execute on function submit_course_for_publication(uuid, uuid[]) to authenticated;

-- Deactivating a catalogue-attached course still requires being an
-- approver of every catalogue it was published to (unchanged). A
-- catalogue-less approved course has nobody in that role, so any member of
-- its own organisation may take it back to inactive -- the same "no
-- catalogue means no external gatekeeper" reasoning as the publish side
-- above, and without it a catalogue-less publish could only ever be
-- reversed by a platform admin.
create or replace function deactivate_course_publication(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_is_admin boolean := is_platform_admin(v_caller);
  v_status text;
  v_organisation_id uuid;
  v_found boolean;
  v_has_publications boolean;
  v_approved_for_all boolean;
  v_is_org_member boolean;
begin
  select status, organisation_id into v_status, v_organisation_id
  from course_catalogue
  where id = p_course_id
  for update;

  v_found := found;

  v_has_publications := v_found and exists (
    select 1 from course_catalogue_publications where course_id = p_course_id
  );

  v_approved_for_all := v_found and not exists (
    select 1
    from course_catalogue_publications ccp
    where ccp.course_id = p_course_id
      and not is_catalogue_approver(ccp.catalogue_id, v_caller)
  );

  v_is_org_member := v_found and v_organisation_id is not null and is_org_member(v_organisation_id, v_caller);

  if not v_is_admin
    and not (v_has_publications and v_approved_for_all)
    and not (not v_has_publications and v_is_org_member)
  then
    raise exception 'Not authorized';
  end if;

  if not v_found then
    raise exception 'Course not found';
  end if;

  if v_status <> 'approved' then
    raise exception 'Only an approved course can be deactivated';
  end if;

  update course_catalogue
  set status = 'inactive', is_current_published = false
  where id = p_course_id;
end;
$$;

revoke all on function deactivate_course_publication(uuid) from public;
grant execute on function deactivate_course_publication(uuid) to authenticated;
