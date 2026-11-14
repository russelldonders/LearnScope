-- Creates a complete AI-generated course in one transaction. The function
-- runs as the caller, so every insert still passes the existing organisation,
-- draft-course and content-resource RLS policies. It only packages those
-- writes atomically so a failed page cannot leave a half-created course.
-- These are the operations the existing provider editor already exposes;
-- spelling the grants out removes its dependency on older projects'
-- ambient public-schema defaults while RLS continues to scope every row.
grant select, insert, update on table public.course_catalogue to authenticated;
grant select, insert, update, delete on table public.course_sections to authenticated;
grant select, insert, update, delete on table public.content_resources to authenticated;
grant select, insert, update, delete on table public.course_content_links to authenticated;

create or replace function public.create_generated_course_draft(
  p_organisation_id uuid,
  p_draft jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_course_id uuid;
  v_section_id uuid;
  v_resource_id uuid;
  v_section record;
  v_page record;
  v_name text := trim(p_draft->>'name');
  v_synopsis text := trim(p_draft->>'synopsis');
  v_course_type text := nullif(trim(p_draft->>'courseType'), '');
  v_duration_value numeric;
  v_duration_unit text := p_draft->>'durationUnit';
  v_duration text;
  v_section_count integer;
  v_page_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_organisation_id is null or not (
    public.is_platform_admin(v_user_id) or public.is_org_member(p_organisation_id, v_user_id)
  ) then
    raise exception 'You cannot create training for this organisation';
  end if;
  if jsonb_typeof(p_draft) <> 'object' then
    raise exception 'Invalid course draft';
  end if;
  if v_name is null or v_name = '' or char_length(v_name) > 200 then
    raise exception 'Course name must be between 1 and 200 characters';
  end if;
  if v_synopsis is null or v_synopsis = '' or char_length(v_synopsis) > 5000 then
    raise exception 'Course synopsis must be between 1 and 5000 characters';
  end if;
  if v_course_type is not null and char_length(v_course_type) > 100 then
    raise exception 'Course type is too long';
  end if;
  if jsonb_typeof(p_draft->'sections') <> 'array' then
    raise exception 'Course sections must be an array';
  end if;
  v_section_count := jsonb_array_length(p_draft->'sections');
  if v_section_count < 1 or v_section_count > 8 then
    raise exception 'A generated course must contain between 1 and 8 sections';
  end if;

  begin
    v_duration_value := (p_draft->>'durationValue')::numeric;
  exception when invalid_text_representation then
    raise exception 'Invalid course duration';
  end;
  if v_duration_value is null or v_duration_value <= 0 or v_duration_value > 10000
     or v_duration_unit not in ('mins', 'hours', 'days', 'weeks') then
    raise exception 'Invalid course duration';
  end if;
  v_duration := v_duration_value::text || ' ' ||
    case
      when v_duration_value = 1 and v_duration_unit = 'mins' then 'minute'
      when v_duration_value = 1 and v_duration_unit = 'hours' then 'hour'
      when v_duration_value = 1 and v_duration_unit = 'days' then 'day'
      when v_duration_value = 1 and v_duration_unit = 'weeks' then 'week'
      when v_duration_unit = 'mins' then 'minutes'
      else v_duration_unit
    end;

  select coalesce(sum(jsonb_array_length(section.value->'pages')), 0)
  into v_page_count
  from jsonb_array_elements(p_draft->'sections') section
  where jsonb_typeof(section.value->'pages') = 'array';
  if v_page_count < v_section_count or v_page_count > 48 then
    raise exception 'A generated course must contain between 1 and 48 pages, with at least one page per section';
  end if;

  insert into public.course_catalogue (
    name, course_type, duration, duration_value, duration_unit, synopsis,
    organisation_id, created_by, status
  ) values (
    v_name, v_course_type, v_duration, v_duration_value, v_duration_unit,
    v_synopsis, p_organisation_id, v_user_id, 'draft'
  ) returning id into v_course_id;

  for v_section in
    select value, ordinality - 1 as position
    from jsonb_array_elements(p_draft->'sections') with ordinality
  loop
    if nullif(trim(v_section.value->>'title'), '') is null
       or char_length(trim(v_section.value->>'title')) > 200
       or jsonb_typeof(v_section.value->'pages') <> 'array'
       or jsonb_array_length(v_section.value->'pages') < 1
       or jsonb_array_length(v_section.value->'pages') > 6 then
      raise exception 'Invalid generated section';
    end if;

    insert into public.course_sections (course_id, title, instructions, position)
    values (
      v_course_id,
      trim(v_section.value->>'title'),
      nullif(left(trim(v_section.value->>'instructions'), 2000), ''),
      v_section.position
    ) returning id into v_section_id;

    for v_page in
      select value, ordinality - 1 as position
      from jsonb_array_elements(v_section.value->'pages') with ordinality
    loop
      if nullif(trim(v_page.value->>'title'), '') is null
         or char_length(trim(v_page.value->>'title')) > 200
         or jsonb_typeof(v_page.value->'pageContent') <> 'object'
         or v_page.value->'pageContent'->>'version' <> '1'
         or jsonb_typeof(v_page.value->'pageContent'->'blocks') <> 'array'
         or jsonb_array_length(v_page.value->'pageContent'->'blocks') < 2
         or jsonb_array_length(v_page.value->'pageContent'->'blocks') > 100 then
        raise exception 'Invalid generated page';
      end if;

      insert into public.content_resources (
        organisation_id, type, title, page_content, created_by
      ) values (
        p_organisation_id, 'page', trim(v_page.value->>'title'),
        v_page.value->'pageContent', v_user_id
      ) returning id into v_resource_id;

      insert into public.course_content_links (
        course_id, resource_id, section_id, position
      ) values (
        v_course_id, v_resource_id, v_section_id, v_page.position
      );
    end loop;
  end loop;

  return v_course_id;
end;
$$;

revoke all on function public.create_generated_course_draft(uuid, jsonb) from public, anon;
grant execute on function public.create_generated_course_draft(uuid, jsonb) to authenticated;
