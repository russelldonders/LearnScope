-- Let a provider request one additional destination for an already-live
-- course without taking that course (or any existing catalogue publication)
-- offline. A null published_at is the existing representation of a pending
-- catalogue decision; learner queries already require published_at is not
-- null, so the Global destination remains invisible until approved.

create or replace function public.request_global_catalogue_publication(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_organisation_id uuid;
  v_status text;
  v_is_current_published boolean;
  v_global_catalogue_id uuid;
begin
  select cc.organisation_id, cc.status, cc.is_current_published
  into v_organisation_id, v_status, v_is_current_published
  from public.course_catalogue cc
  where cc.id = p_course_id
  for update;

  if not found then
    raise exception 'Course not found';
  end if;

  if v_caller is null
    or v_organisation_id is null
    or not public.is_org_member(v_organisation_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  if v_status <> 'approved' or not v_is_current_published then
    raise exception 'Only the current approved course version can be submitted to the Global catalogue';
  end if;

  select c.id into v_global_catalogue_id
  from public.catalogues c
  where c.is_global;

  if v_global_catalogue_id is null then
    raise exception 'The Global catalogue could not be found';
  end if;

  if exists (
    select 1
    from public.course_catalogue_publications ccp
    where ccp.course_id = p_course_id
      and ccp.catalogue_id = v_global_catalogue_id
      and ccp.published_at is not null
  ) then
    raise exception 'This course is already published to the Global catalogue';
  end if;

  insert into public.course_catalogue_publications (
    course_id,
    catalogue_id,
    selected_by,
    published_at
  )
  values (p_course_id, v_global_catalogue_id, v_caller, null)
  on conflict (course_id, catalogue_id) do nothing;
end;
$$;

revoke all on function public.request_global_catalogue_publication(uuid) from public, anon, authenticated;
grant execute on function public.request_global_catalogue_publication(uuid) to authenticated;

create or replace function public.approve_global_catalogue_publication(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_course_name text;
  v_global_catalogue_id uuid;
begin
  if v_caller is null or not public.is_platform_admin(v_caller) then
    raise exception 'Not authorized';
  end if;

  select cc.name into v_course_name
  from public.course_catalogue cc
  where cc.id = p_course_id
    and cc.status = 'approved'
    and cc.is_current_published
  for update;

  if not found then
    raise exception 'Only the current approved course version can be added to the Global catalogue';
  end if;

  select c.id into v_global_catalogue_id
  from public.catalogues c
  where c.is_global;

  update public.course_catalogue_publications ccp
  set published_at = now()
  where ccp.course_id = p_course_id
    and ccp.catalogue_id = v_global_catalogue_id
    and ccp.published_at is null;

  if not found then
    raise exception 'No pending Global catalogue request was found';
  end if;

  insert into public.admin_activity_log (
    actor_id, actor_label, action, entity_type, entity_id, entity_label
  )
  values (
    v_caller,
    public.admin_activity_actor_label(v_caller),
    'course.global_catalogue_approved',
    'course_catalogue',
    p_course_id,
    v_course_name
  );
end;
$$;

revoke all on function public.approve_global_catalogue_publication(uuid) from public, anon, authenticated;
grant execute on function public.approve_global_catalogue_publication(uuid) to authenticated;

create or replace function public.reject_global_catalogue_publication(p_course_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_course_name text;
  v_global_catalogue_id uuid;
  v_reason text := nullif(trim(p_reason), '');
begin
  if v_caller is null or not public.is_platform_admin(v_caller) then
    raise exception 'Not authorized';
  end if;

  if v_reason is null then
    raise exception 'A rejection reason is required';
  end if;

  select cc.name into v_course_name
  from public.course_catalogue cc
  where cc.id = p_course_id
  for update;

  if not found then
    raise exception 'Course not found';
  end if;

  select c.id into v_global_catalogue_id
  from public.catalogues c
  where c.is_global;

  delete from public.course_catalogue_publications ccp
  where ccp.course_id = p_course_id
    and ccp.catalogue_id = v_global_catalogue_id
    and ccp.published_at is null;

  if not found then
    raise exception 'No pending Global catalogue request was found';
  end if;

  insert into public.admin_activity_log (
    actor_id, actor_label, action, entity_type, entity_id, entity_label, reason
  )
  values (
    v_caller,
    public.admin_activity_actor_label(v_caller),
    'course.global_catalogue_rejected',
    'course_catalogue',
    p_course_id,
    v_course_name,
    v_reason
  );
end;
$$;

revoke all on function public.reject_global_catalogue_publication(uuid, text) from public, anon, authenticated;
grant execute on function public.reject_global_catalogue_publication(uuid, text) to authenticated;
