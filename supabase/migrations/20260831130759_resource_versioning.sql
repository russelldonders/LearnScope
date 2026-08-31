-- Immutable resource version families. Existing rows remain live as
-- published v1, preserving every course and catalogue link.
alter table content_resources
  add column version_group_id uuid,
  add column version_number integer,
  add column status text,
  add column is_current_published boolean,
  add column published_at timestamptz,
  add column published_by uuid references auth.users(id) on delete set null;

update content_resources
set version_group_id = id,
    version_number = 1,
    status = 'published',
    is_current_published = true,
    published_at = created_at,
    published_by = created_by;

alter table content_resources
  alter column version_group_id set not null,
  alter column version_number set not null,
  alter column version_number set default 1,
  alter column status set not null,
  alter column status set default 'published',
  alter column is_current_published set not null,
  alter column is_current_published set default true,
  add constraint content_resources_version_number_positive check (version_number > 0),
  add constraint content_resources_status_check check (status in ('draft', 'published', 'inactive')),
  add constraint content_resources_version_group_version_key unique (version_group_id, version_number);

create unique index content_resources_one_current_published_idx
  on content_resources (version_group_id)
  where is_current_published;

create index content_resources_version_group_idx
  on content_resources (version_group_id, version_number desc);

create or replace function initialise_resource_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.version_group_id := coalesce(new.version_group_id, new.id);
  new.version_number := coalesce(new.version_number, 1);
  new.status := coalesce(new.status, 'published');
  new.is_current_published := coalesce(new.is_current_published, new.status = 'published');
  if new.status = 'published' then
    new.published_at := coalesce(new.published_at, now());
    new.published_by := coalesce(new.published_by, new.created_by);
  end if;
  return new;
end;
$$;

create trigger initialise_resource_version_trigger
  before insert on content_resources
  for each row execute procedure initialise_resource_version();

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
    external_url, video_edit, created_by, version_group_id, version_number,
    status, is_current_published, published_at, published_by
  ) values (
    v_new_id, v_source.organisation_id, v_source.type, v_source.title,
    v_source.storage_path, v_source.file_name, v_source.launch_path,
    v_source.external_url, v_source.video_edit, v_caller,
    v_source.version_group_id, v_next_version, 'draft', false, null, null
  );

  return v_new_id;
end;
$$;

create or replace function publish_resource_version(p_resource_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_resource public.content_resources%rowtype;
begin
  select * into v_resource
  from public.content_resources
  where id = p_resource_id
  for update;

  if v_resource.id is null
    or v_caller is null
    or not public.is_org_member(v_resource.organisation_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  if v_resource.status <> 'draft' then
    raise exception 'Only a draft resource version can be published';
  end if;

  update public.content_resources
  set status = 'inactive', is_current_published = false, updated_at = now()
  where version_group_id = v_resource.version_group_id
    and is_current_published;

  update public.content_resources
  set status = 'published',
      is_current_published = true,
      published_at = now(),
      published_by = v_caller,
      updated_at = now()
  where id = p_resource_id;

  update public.catalogue_resources cr
  set resource_id = p_resource_id
  where cr.resource_id in (
    select id from public.content_resources
    where version_group_id = v_resource.version_group_id
      and id <> p_resource_id
  )
  and not exists (
    select 1 from public.catalogue_resources existing
    where existing.catalogue_id = cr.catalogue_id
      and existing.resource_id = p_resource_id
  );
end;
$$;

revoke all on function create_resource_draft_version(uuid) from public, anon, authenticated;
revoke all on function publish_resource_version(uuid) from public, anon, authenticated;
grant execute on function create_resource_draft_version(uuid) to authenticated;
grant execute on function publish_resource_version(uuid) to authenticated;

-- Resource rows are immutable once published. Direct client updates are
-- limited to drafts; the narrowly-scoped publish function performs the
-- controlled state transition.
drop policy "Org members manage their own organisation's resources" on content_resources;

create policy "Org members create resources for their organisation"
  on content_resources for insert to authenticated
  with check (
    is_platform_admin((select auth.uid()))
    or is_org_member(organisation_id, (select auth.uid()))
  );

create policy "Org members update draft resources"
  on content_resources for update to authenticated
  using (
    status = 'draft'
    and (
      is_platform_admin((select auth.uid()))
      or is_org_member(organisation_id, (select auth.uid()))
    )
  )
  with check (
    status = 'draft'
    and not is_current_published
    and (
      is_platform_admin((select auth.uid()))
      or is_org_member(organisation_id, (select auth.uid()))
    )
  );

create policy "Org members delete resources for their organisation"
  on content_resources for delete to authenticated
  using (
    is_platform_admin((select auth.uid()))
    or is_org_member(organisation_id, (select auth.uid()))
  );

-- Catalogue assignments accept only the current published version.
drop policy "Catalogue admins can assign resources" on catalogue_resources;
create policy "Catalogue admins can assign resources"
  on catalogue_resources for insert to authenticated
  with check (
    is_catalogue_admin(catalogue_resources.catalogue_id, (select auth.uid()))
    and catalogue_resources.created_by = (select auth.uid())
    and exists (
      select 1
      from catalogues c
      join content_resources cr on cr.organisation_id = c.organisation_id
      where c.id = catalogue_resources.catalogue_id
        and cr.id = catalogue_resources.resource_id
        and cr.status = 'published'
        and cr.is_current_published
    )
  );
