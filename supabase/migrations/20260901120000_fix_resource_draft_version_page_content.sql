-- create_resource_draft_version (20260831130759) predates page_content
-- (20260831150000) and never copied it into the new draft row, so
-- creating a new version of a 'page' resource always violated
-- content_resources_storage_or_external_check (which requires page_content
-- to be set whenever type = 'page'). v_source is a full %rowtype select,
-- so v_source.page_content is already populated -- it just needed adding
-- to the explicit insert column list.
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
    external_url, video_edit, page_content, created_by, version_group_id,
    version_number, status, is_current_published, published_at, published_by
  ) values (
    v_new_id, v_source.organisation_id, v_source.type, v_source.title,
    v_source.storage_path, v_source.file_name, v_source.launch_path,
    v_source.external_url, v_source.video_edit, v_source.page_content, v_caller,
    v_source.version_group_id, v_next_version, 'draft', false, null, null
  );

  return v_new_id;
end;
$$;

revoke all on function create_resource_draft_version(uuid) from public, anon, authenticated;
grant execute on function create_resource_draft_version(uuid) to authenticated;
