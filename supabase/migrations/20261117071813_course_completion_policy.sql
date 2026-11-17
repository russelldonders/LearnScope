-- Course authors choose whether completion is earned by finishing every
-- linked content resource or by the learner explicitly marking the whole
-- course complete. Existing and new courses default to all content, so the
-- stricter behaviour is applied without requiring providers to revisit
-- their catalogue. Published versions are immutable under the existing RLS;
-- providers change this on a draft/next version like every other setting.
alter table public.course_catalogue
  add column completion_policy text not null default 'all_content'
  constraint course_catalogue_completion_policy_check
  check (completion_policy in ('all_content', 'manual'));

-- The learner uses one RPC for either policy. For all_content, eligibility
-- is checked atomically against the published course's links and the
-- caller's own progress. A course with no content cannot complete
-- automatically. Manual courses deliberately require no item progress.
create or replace function public.complete_my_course(p_course_id uuid)
returns date
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_catalogue_course_id uuid;
  v_policy text;
  v_completed_date date;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select personal.catalogue_course_id, catalogue.completion_policy, personal.completed_date
    into v_catalogue_course_id, v_policy, v_completed_date
  from public.courses personal
  join public.course_catalogue catalogue on catalogue.id = personal.catalogue_course_id
  where personal.id = p_course_id
    and personal.user_id = v_user_id
    and personal.status is null;

  if not found then
    raise exception 'Course not found or not enrolled';
  end if;

  if v_completed_date is not null then
    return v_completed_date;
  end if;

  if v_policy = 'all_content' and not (
    exists (
      select 1 from public.course_content_links link
      where link.course_id = v_catalogue_course_id
    )
    and not exists (
      select 1
      from public.course_content_links link
      where link.course_id = v_catalogue_course_id
        and not exists (
          select 1
          from public.course_content_progress progress
          where progress.content_item_id = link.resource_id
            and progress.user_id = v_user_id
            and progress.status in ('completed', 'passed')
        )
    )
  ) then
    raise exception 'Complete every course item before finishing this course';
  end if;

  update public.courses
  set completed_date = current_date
  where id = p_course_id and user_id = v_user_id
  returning completed_date into v_completed_date;

  return v_completed_date;
end;
$$;

revoke all on function public.complete_my_course(uuid) from public, anon;
grant execute on function public.complete_my_course(uuid) to authenticated;

-- Keep version cloning aligned with the newest definition (price fields
-- from 20260902260000 and section instructions from 0108) while adding the
-- completion policy to the copied course settings.
create or replace function public.create_course_draft_version(p_course_id uuid)
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
    version_number, is_current_published, price_amount, price_currency,
    completion_policy
  ) values (
    v_new_id, v_source.name, v_source.provider, v_source.course_type,
    v_source.duration, v_source.synopsis, v_source.organisation_id,
    'draft', (select auth.uid()), v_source.image_url, v_source.course_code,
    v_source.version_group_id, v_new_version, false,
    v_source.price_amount, v_source.price_currency, v_source.completion_policy
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

revoke all on function public.create_course_draft_version(uuid) from public;
grant execute on function public.create_course_draft_version(uuid) to authenticated;
