-- Prefixed reference code for org resource-library items (RES-00001),
-- matching the CRS-/ORG-/USR-/SKL- codes already established (0113) for
-- courses/providers/users/skills. content_resources is versioned exactly
-- like course_catalogue (version_group_id/version_number,
-- 20260831130759), so this follows course_code's shape exactly: nullable
-- column, generate-if-null trigger, uniqueness scoped to each
-- version_group's v1 row only, and create_resource_draft_version copies
-- the code forward explicitly rather than letting a new version get a
-- freshly generated one.

create sequence resource_code_seq;

create or replace function generate_resource_code()
returns text
language sql
as $$
  select 'RES-' || lpad(nextval('resource_code_seq')::text, 5, '0')
$$;

alter table content_resources add column resource_code text;

create or replace function set_resource_code()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.resource_code is null then
    new.resource_code := generate_resource_code();
  end if;
  return new;
end;
$$;

create trigger set_resource_code_trigger
  before insert on content_resources
  for each row execute procedure set_resource_code();

-- Backfill: one code per version_group, reusing an existing non-null code
-- already present anywhere in that group (defensive) before generating a
-- fresh one, then propagated to every row in the group.
do $$
declare
  r record;
  v_code text;
begin
  for r in
    select distinct version_group_id
    from content_resources
    where version_group_id in (
      select version_group_id from content_resources where resource_code is null
    )
    order by version_group_id
  loop
    select resource_code into v_code
    from content_resources
    where version_group_id = r.version_group_id and resource_code is not null
    limit 1;

    if v_code is null then
      v_code := generate_resource_code();
    end if;

    update content_resources
    set resource_code = v_code
    where version_group_id = r.version_group_id and resource_code is null;
  end loop;
end $$;

create unique index content_resources_resource_code_unique_idx
  on content_resources (resource_code)
  where version_number = 1;

-- create_resource_draft_version must now also copy resource_code forward
-- (same reasoning as course_code in create_course_draft_version) so a new
-- draft version keeps its published parent's code instead of getting a
-- freshly generated one.
create or replace function create_resource_draft_version(p_resource_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_source public.content_resources%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_next_version integer;
begin
  select * into v_source
  from public.content_resources
  where id = p_resource_id
  for update;

  if v_source.id is null
    or v_caller is null
    or not public.is_org_member(v_source.organisation_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  if v_source.status <> 'published' or not v_source.is_current_published then
    raise exception 'Create a version from the current published resource';
  end if;

  if exists (
    select 1 from public.content_resources
    where version_group_id = v_source.version_group_id and status = 'draft'
  ) then
    raise exception 'This resource already has a draft version';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version
  from public.content_resources
  where version_group_id = v_source.version_group_id;

  insert into public.content_resources (
    id, organisation_id, type, title, storage_path, file_name, launch_path,
    external_url, video_edit, page_content, resource_code, created_by,
    version_group_id, version_number, status, is_current_published,
    published_at, published_by
  ) values (
    v_new_id, v_source.organisation_id, v_source.type, v_source.title,
    v_source.storage_path, v_source.file_name, v_source.launch_path,
    v_source.external_url, v_source.video_edit, v_source.page_content,
    v_source.resource_code, v_caller, v_source.version_group_id,
    v_next_version, 'draft', false, null, null
  );

  return v_new_id;
end;
$$;

revoke all on function create_resource_draft_version(uuid) from public, anon, authenticated;
grant execute on function create_resource_draft_version(uuid) to authenticated;
