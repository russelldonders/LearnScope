-- Tighten catalogue assignment: only a current course version that has
-- already been approved and published to at least one catalogue may be
-- added from inside another catalogue.
create or replace function assign_course_to_catalogue(p_catalogue_id uuid, p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_catalogue_organisation_id uuid;
  v_course_organisation_id uuid;
  v_course_status text;
  v_is_current_published boolean;
begin
  if v_caller is null or not is_catalogue_admin(p_catalogue_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  select organisation_id
  into v_catalogue_organisation_id
  from catalogues
  where id = p_catalogue_id
    and not is_global;

  select organisation_id, status, is_current_published
  into v_course_organisation_id, v_course_status, v_is_current_published
  from course_catalogue
  where id = p_course_id
  for update;

  if v_catalogue_organisation_id is null
    or v_course_organisation_id is distinct from v_catalogue_organisation_id then
    raise exception 'Course and catalogue must belong to the same organisation';
  end if;

  if v_course_status <> 'approved'
    or not v_is_current_published
    or not is_course_published_to_catalogue(p_course_id) then
    raise exception 'Only published courses can be added to a catalogue';
  end if;

  insert into course_catalogue_publications (
    course_id,
    catalogue_id,
    selected_by,
    published_at
  )
  values (p_course_id, p_catalogue_id, v_caller, now())
  on conflict (course_id, catalogue_id) do nothing;
end;
$$;

revoke all on function assign_course_to_catalogue(uuid, uuid) from public, anon, authenticated;
grant execute on function assign_course_to_catalogue(uuid, uuid) to authenticated;
