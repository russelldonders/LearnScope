-- Platform administrators can turn a curated skill into one editable course
-- per knowledge-matrix level. Course content is still produced by the
-- existing AI/page-builder pipeline; these functions only package the
-- database writes needed to attach the skill and optionally publish the
-- result into the platform-owned Global catalogue.

create or replace function public.create_generated_skill_course(
  p_skill_library_id uuid,
  p_level integer,
  p_draft jsonb,
  p_publish_global boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_system_organisation_id uuid;
  v_global_catalogue_id uuid;
  v_course_id uuid;
  v_course_name text;
begin
  if v_caller is null or not public.is_platform_admin(v_caller) then
    raise insufficient_privilege using message = 'Platform administrator access required';
  end if;

  if p_level not between 1 and 5 then
    raise exception 'Knowledge level must be between 1 and 5';
  end if;

  if not exists (
    select 1
    from public.skill_library skill
    where skill.id = p_skill_library_id
      and skill.status = 'active'
  ) then
    raise exception 'Select an active skill';
  end if;

  select organisation.id
  into v_system_organisation_id
  from public.organisations organisation
  where organisation.is_system
    and organisation.status = 'active';

  select catalogue.id
  into v_global_catalogue_id
  from public.catalogues catalogue
  where catalogue.is_global
    and catalogue.organisation_id = v_system_organisation_id;

  if v_system_organisation_id is null or v_global_catalogue_id is null then
    raise exception 'The system provider or Global catalogue is not configured';
  end if;

  v_course_id := public.create_generated_course_draft(v_system_organisation_id, p_draft);

  insert into public.course_catalogue_skills (
    course_catalogue_id,
    skill_library_id,
    level
  ) values (
    v_course_id,
    p_skill_library_id,
    p_level
  );

  -- Curating a provider-owned skill into a Global course also makes the
  -- skill itself discoverable in the Global catalogue. The unique key turns
  -- repeat builds for the same skill into a harmless no-op here.
  insert into public.catalogue_skills (
    catalogue_id,
    skill_library_id,
    created_by
  ) values (
    v_global_catalogue_id,
    p_skill_library_id,
    v_caller
  ) on conflict (catalogue_id, skill_library_id) do nothing;

  select course.name into v_course_name
  from public.course_catalogue course
  where course.id = v_course_id;

  insert into public.admin_activity_log (
    actor_id,
    actor_label,
    action,
    entity_type,
    entity_id,
    entity_label
  ) values (
    v_caller,
    public.admin_activity_actor_label(v_caller),
    'course.ai_level_generated',
    'course_catalogue',
    v_course_id,
    v_course_name
  );

  if p_publish_global then
    insert into public.course_catalogue_publications (
      course_id,
      catalogue_id,
      selected_by,
      published_at
    ) values (
      v_course_id,
      v_global_catalogue_id,
      v_caller,
      null
    );

    perform public.publish_course_version(v_course_id);
  end if;

  return v_course_id;
end;
$$;

revoke all on function public.create_generated_skill_course(uuid, integer, jsonb, boolean)
  from public, anon;
grant execute on function public.create_generated_skill_course(uuid, integer, jsonb, boolean)
  to authenticated;

create or replace function public.publish_system_course_to_global(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_global_catalogue_id uuid;
begin
  if v_caller is null or not public.is_platform_admin(v_caller) then
    raise insufficient_privilege using message = 'Platform administrator access required';
  end if;

  if not exists (
    select 1
    from public.course_catalogue course
    join public.organisations organisation
      on organisation.id = course.organisation_id
    where course.id = p_course_id
      and organisation.is_system
      and course.status in ('draft', 'rejected')
  ) then
    raise exception 'Only an editable system-provider course can be published here';
  end if;

  select catalogue.id into v_global_catalogue_id
  from public.catalogues catalogue
  where catalogue.is_global;

  if v_global_catalogue_id is null then
    raise exception 'The Global catalogue could not be found';
  end if;

  insert into public.course_catalogue_publications (
    course_id,
    catalogue_id,
    selected_by,
    published_at
  ) values (
    p_course_id,
    v_global_catalogue_id,
    v_caller,
    null
  ) on conflict (course_id, catalogue_id) do nothing;

  perform public.publish_course_version(p_course_id);
end;
$$;

revoke all on function public.publish_system_course_to_global(uuid)
  from public, anon;
grant execute on function public.publish_system_course_to_global(uuid)
  to authenticated;
