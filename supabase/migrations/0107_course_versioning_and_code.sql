-- Immutable published course versions. Providers edit a cloned draft while
-- the currently approved version remains live for learners.

alter table course_catalogue
  add column course_code text,
  add column version_group_id uuid,
  add column version_number integer not null default 1 check (version_number > 0),
  add column is_current_published boolean not null default false;

update course_catalogue
set version_group_id = id,
    is_current_published = (status = 'approved');

alter table course_catalogue alter column version_group_id set not null;

create unique index course_catalogue_group_version_idx
  on course_catalogue (version_group_id, version_number);

create unique index course_catalogue_one_current_published_idx
  on course_catalogue (version_group_id)
  where is_current_published;

create index course_catalogue_org_group_version_idx
  on course_catalogue (organisation_id, version_group_id, version_number desc);

drop policy if exists "Organisation members can unpublish their own approved course" on course_catalogue;

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
    select id, title, position
    from course_sections
    where course_id = p_course_id
    order by position, created_at
  loop
    v_new_section_id := gen_random_uuid();
    insert into course_sections (id, course_id, title, position)
    values (v_new_section_id, v_new_id, v_section.title, v_section.position);

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

create or replace function publish_course_version(p_course_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if not is_platform_admin((select auth.uid())) then
    raise exception 'Not authorized';
  end if;

  select version_group_id into v_group_id
  from course_catalogue
  where id = p_course_id
  for update;

  if v_group_id is null then
    raise exception 'Course not found';
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

revoke all on function publish_course_version(uuid) from public;
grant execute on function publish_course_version(uuid) to authenticated;

create or replace function get_provider_profile(p_slug text)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'organisation', (
      select json_build_object('id', o.id, 'name', o.name, 'about', o.about, 'logoUrl', o.logo_url, 'url', o.url)
      from organisations o
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'skills', (
      select coalesce(json_agg(json_build_object(
        'id', sl.id, 'name', sl.name, 'category', sl.category, 'description', sl.description
      ) order by sl.name), '[]'::json)
      from organisation_offered_skills oos
      join skill_library sl on sl.id = oos.skill_library_id
      join organisations o on o.id = oos.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'courses', (
      select coalesce(json_agg(json_build_object(
        'id', cc.id, 'name', cc.name, 'synopsis', cc.synopsis,
        'courseType', cc.course_type, 'duration', cc.duration,
        'imageUrl', cc.image_url, 'courseCode', cc.course_code,
        'versionNumber', cc.version_number,
        'skillEntries', (
          select coalesce(json_agg(json_build_object(
            'skillId', ccs.skill_library_id, 'skillName', sl2.name, 'level', ccs.level
          )), '[]'::json)
          from course_catalogue_skills ccs
          join skill_library sl2 on sl2.id = ccs.skill_library_id
          where ccs.course_catalogue_id = cc.id
        ),
        'tags', (
          select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name)), '[]'::json)
          from course_catalogue_tags cct
          join tags t on t.id = cct.tag_id
          where cct.course_catalogue_id = cc.id
        )
      ) order by cc.name), '[]'::json)
      from course_catalogue cc
      join organisations o on o.id = cc.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
        and cc.status = 'approved' and cc.is_current_published
    )
  )
$$;

grant execute on function get_provider_profile(text) to anon, authenticated;
