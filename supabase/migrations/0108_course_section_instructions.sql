-- Optional learner-facing guidance for each course section. Keep version
-- cloning in sync so a provider's instructions carry into the next draft.

alter table course_sections
  add column instructions text;

create or replace function create_course_draft_version(p_course_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source course_catalogue%rowtype;
  v_existing_id uuid;
  v_new_id uuid := gen_random_uuid();
  v_new_version integer;
  v_section record;
  v_new_section_id uuid;
begin
  select * into v_source
  from course_catalogue
  where id = p_course_id and status = 'approved';

  if not found then
    raise exception 'Only an approved course can be versioned';
  end if;

  if not (
    is_platform_admin((select auth.uid()))
    or (
      v_source.organisation_id is not null
      and is_org_member(v_source.organisation_id, (select auth.uid()))
    )
  ) then
    raise exception 'Not authorized';
  end if;

  select id into v_existing_id
  from course_catalogue
  where version_group_id = v_source.version_group_id
    and status in ('draft', 'pending_approval', 'rejected')
  order by version_number desc
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_new_version
  from course_catalogue
  where version_group_id = v_source.version_group_id;

  insert into course_catalogue (
    id, name, provider, course_type, duration, synopsis, organisation_id,
    status, created_by, image_url, course_code, version_group_id,
    version_number, is_current_published
  ) values (
    v_new_id, v_source.name, v_source.provider, v_source.course_type,
    v_source.duration, v_source.synopsis, v_source.organisation_id,
    'draft', (select auth.uid()), v_source.image_url, v_source.course_code,
    v_source.version_group_id, v_new_version, false
  );

  insert into course_catalogue_skills (course_catalogue_id, skill_library_id, level)
  select v_new_id, skill_library_id, level
  from course_catalogue_skills
  where course_catalogue_id = p_course_id;

  insert into course_catalogue_tags (course_catalogue_id, tag_id)
  select v_new_id, tag_id
  from course_catalogue_tags
  where course_catalogue_id = p_course_id;

  for v_section in
    select id, title, instructions, position
    from course_sections
    where course_id = p_course_id
    order by position, created_at
  loop
    v_new_section_id := gen_random_uuid();
    insert into course_sections (id, course_id, title, instructions, position)
    values (v_new_section_id, v_new_id, v_section.title, v_section.instructions, v_section.position);

    insert into course_content_links (course_id, resource_id, position, section_id)
    select v_new_id, resource_id, position, v_new_section_id
    from course_content_links
    where course_id = p_course_id and section_id = v_section.id;
  end loop;

  insert into course_content_links (course_id, resource_id, position, section_id)
  select v_new_id, resource_id, position, null
  from course_content_links
  where course_id = p_course_id and section_id is null;

  return v_new_id;
end;
$$;

revoke all on function create_course_draft_version(uuid) from public;
grant execute on function create_course_draft_version(uuid) to authenticated;
