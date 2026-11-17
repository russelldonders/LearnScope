-- A scored test is complete once it has been submitted and marked. Its
-- success outcome remains available as passed/failed, while both terminal
-- outcomes satisfy an all-content course's completion requirement.
create or replace function public.complete_my_course(p_course_id uuid)
returns date
language plpgsql
-- Completion policy must not be bypassable through a direct table update.
-- This narrowly scoped definer function performs its own auth.uid(), course
-- ownership and progress checks before changing only completed_date.
security definer
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
            and progress.status in ('completed', 'passed', 'failed')
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
