-- Versioned composite skills. Every parent and component remains an ordinary
-- skill_library row; these tables only describe how independently reusable
-- skills form a broader capability. Published versions are immutable and
-- edits happen in a cloned draft.

create table public.skill_composite_definitions (
  id uuid primary key default gen_random_uuid(),
  parent_skill_id uuid not null references public.skill_library(id) on delete cascade,
  organisation_id uuid references public.organisations(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (parent_skill_id, version),
  check (
    (status = 'draft' and published_at is null)
    or (status in ('published', 'archived') and published_at is not null)
  )
);

create unique index skill_composite_one_draft_idx
  on public.skill_composite_definitions (parent_skill_id)
  where status = 'draft';

create unique index skill_composite_one_published_idx
  on public.skill_composite_definitions (parent_skill_id)
  where status = 'published';

create index skill_composite_owner_idx
  on public.skill_composite_definitions (organisation_id, status, parent_skill_id);

create table public.skill_composite_components (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.skill_composite_definitions(id) on delete cascade,
  component_skill_id uuid not null references public.skill_library(id) on delete restrict,
  is_required boolean not null default true,
  target_level smallint not null default 1 check (target_level between 1 and 5),
  contribution_weight numeric(7, 4) not null default 1 check (contribution_weight > 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (definition_id, component_skill_id)
);

create index skill_composite_component_skill_idx
  on public.skill_composite_components (component_skill_id, definition_id);

create or replace function public.can_manage_skill_composite(
  p_parent_skill_id uuid,
  p_user_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.skill_library skill
    where skill.id = p_parent_skill_id
      and not skill.is_private
      and (
        public.is_platform_admin(p_user_id)
        or (
          skill.organisation_id is not null
          and public.is_org_admin(skill.organisation_id, p_user_id)
        )
        or (
          skill.organisation_id is null
          and exists (
            select 1
            from public.organisations system_provider
            where system_provider.is_system
              and public.is_org_admin(system_provider.id, p_user_id)
          )
        )
      )
  )
$$;

revoke all on function public.can_manage_skill_composite(uuid, uuid) from public;
grant execute on function public.can_manage_skill_composite(uuid, uuid) to authenticated;

create or replace function public.validate_skill_composite_component()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_skill_id uuid;
  v_parent_organisation_id uuid;
  v_definition_status text;
  v_component_organisation_id uuid;
  v_component_is_private boolean;
begin
  if tg_op = 'UPDATE' and (
    new.definition_id is distinct from old.definition_id
    or new.component_skill_id is distinct from old.component_skill_id
    or new.created_by is distinct from old.created_by
  ) then
    raise exception 'A component relationship cannot be reassigned; remove it and add a new component';
  end if;

  select definition.parent_skill_id, definition.organisation_id, definition.status
  into v_parent_skill_id, v_parent_organisation_id, v_definition_status
  from public.skill_composite_definitions definition
  where definition.id = new.definition_id;

  if v_parent_skill_id is null then
    raise exception 'Composite definition not found';
  end if;

  if v_definition_status <> 'draft' then
    raise exception 'Published composite definitions are immutable; create a new draft version';
  end if;

  if new.component_skill_id = v_parent_skill_id then
    raise exception 'A skill cannot be its own component';
  end if;

  select skill.organisation_id, skill.is_private
  into v_component_organisation_id, v_component_is_private
  from public.skill_library skill
  where skill.id = new.component_skill_id;

  if not found or v_component_is_private then
    raise exception 'Component skill must be a shared library skill';
  end if;

  if v_parent_organisation_id is null and v_component_organisation_id is not null then
    raise exception 'A global composite can only use global component skills';
  end if;

  if v_parent_organisation_id is not null
     and v_component_organisation_id is not null
     and v_component_organisation_id <> v_parent_organisation_id then
    raise exception 'A provider composite cannot use another provider''s private library skill';
  end if;

  if exists (
    with recursive descendants(skill_id) as (
      select component.component_skill_id
      from public.skill_composite_definitions definition
      join public.skill_composite_components component
        on component.definition_id = definition.id
      where definition.parent_skill_id = new.component_skill_id
        and definition.status in ('draft', 'published')
        and component.id is distinct from new.id
      union
      select component.component_skill_id
      from descendants
      join public.skill_composite_definitions definition
        on definition.parent_skill_id = descendants.skill_id
       and definition.status in ('draft', 'published')
      join public.skill_composite_components component
        on component.definition_id = definition.id
      where component.id is distinct from new.id
    )
    select 1 from descendants where skill_id = v_parent_skill_id
  ) then
    raise exception 'This component would create a circular skill relationship';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_skill_composite_component() from public;

create trigger validate_skill_composite_component_trigger
  before insert or update on public.skill_composite_components
  for each row execute procedure public.validate_skill_composite_component();

create or replace function public.prevent_published_composite_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.skill_composite_definitions
  where id = coalesce(old.definition_id, new.definition_id);

  if v_status <> 'draft' then
    raise exception 'Published composite definitions are immutable; create a new draft version';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.prevent_published_composite_changes() from public;

create trigger prevent_published_composite_component_changes_trigger
  before update or delete on public.skill_composite_components
  for each row execute procedure public.prevent_published_composite_changes();

create or replace function public.create_skill_composite_draft(p_parent_skill_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_organisation_id uuid;
  v_existing_draft_id uuid;
  v_published_id uuid;
  v_draft_id uuid;
  v_next_version integer;
begin
  if v_user_id is null or not public.can_manage_skill_composite(p_parent_skill_id, v_user_id) then
    raise exception 'Not authorized to manage this composite skill';
  end if;

  -- Serialize draft/version creation per parent so two simultaneous editor
  -- opens cannot both choose the same next version number.
  perform pg_advisory_xact_lock(hashtextextended(p_parent_skill_id::text, 0));

  select skill.organisation_id into v_organisation_id
  from public.skill_library skill
  where skill.id = p_parent_skill_id and not skill.is_private
  for share;

  select id into v_existing_draft_id
  from public.skill_composite_definitions
  where parent_skill_id = p_parent_skill_id and status = 'draft';

  if v_existing_draft_id is not null then
    return v_existing_draft_id;
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.skill_composite_definitions
  where parent_skill_id = p_parent_skill_id;

  insert into public.skill_composite_definitions
    (parent_skill_id, organisation_id, version, created_by)
  values
    (p_parent_skill_id, v_organisation_id, v_next_version, v_user_id)
  returning id into v_draft_id;

  select id into v_published_id
  from public.skill_composite_definitions
  where parent_skill_id = p_parent_skill_id and status = 'published';

  if v_published_id is not null then
    insert into public.skill_composite_components
      (definition_id, component_skill_id, is_required, target_level, contribution_weight, sort_order, created_by)
    select v_draft_id, component_skill_id, is_required, target_level, contribution_weight, sort_order, v_user_id
    from public.skill_composite_components
    where definition_id = v_published_id
    order by sort_order, created_at;
  end if;

  return v_draft_id;
end;
$$;

revoke all on function public.create_skill_composite_draft(uuid) from public;
grant execute on function public.create_skill_composite_draft(uuid) to authenticated;

create or replace function public.publish_skill_composite(p_definition_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_parent_skill_id uuid;
  v_status text;
begin
  select parent_skill_id, status into v_parent_skill_id, v_status
  from public.skill_composite_definitions
  where id = p_definition_id
  for update;

  if v_parent_skill_id is null or v_status <> 'draft' then
    raise exception 'Draft composite definition not found';
  end if;

  if v_user_id is null or not public.can_manage_skill_composite(v_parent_skill_id, v_user_id) then
    raise exception 'Not authorized to publish this composite skill';
  end if;

  if not exists (
    select 1 from public.skill_composite_components where definition_id = p_definition_id
  ) then
    raise exception 'Add at least one component skill before publishing';
  end if;

  update public.skill_composite_definitions
  set status = 'archived'
  where parent_skill_id = v_parent_skill_id and status = 'published';

  update public.skill_composite_definitions
  set status = 'published', published_at = now()
  where id = p_definition_id;
end;
$$;

revoke all on function public.publish_skill_composite(uuid) from public;
grant execute on function public.publish_skill_composite(uuid) to authenticated;

alter table public.skill_composite_definitions enable row level security;
alter table public.skill_composite_components enable row level security;

create policy "Published composites and managers can view definitions"
  on public.skill_composite_definitions for select
  to authenticated
  using (
    status = 'published'
    or public.can_manage_skill_composite(parent_skill_id, (select auth.uid()))
  );

create policy "Published composite components and managers can view components"
  on public.skill_composite_components for select
  to authenticated
  using (
    exists (
      select 1
      from public.skill_composite_definitions definition
      where definition.id = skill_composite_components.definition_id
        and (
          definition.status = 'published'
          or public.can_manage_skill_composite(definition.parent_skill_id, (select auth.uid()))
        )
    )
  );

create policy "Managers can add draft composite components"
  on public.skill_composite_components for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.skill_composite_definitions definition
      where definition.id = skill_composite_components.definition_id
        and definition.status = 'draft'
        and public.can_manage_skill_composite(definition.parent_skill_id, (select auth.uid()))
    )
  );

create policy "Managers can update draft composite components"
  on public.skill_composite_components for update
  to authenticated
  using (
    exists (
      select 1
      from public.skill_composite_definitions definition
      where definition.id = skill_composite_components.definition_id
        and definition.status = 'draft'
        and public.can_manage_skill_composite(definition.parent_skill_id, (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1
      from public.skill_composite_definitions definition
      where definition.id = skill_composite_components.definition_id
        and definition.status = 'draft'
        and public.can_manage_skill_composite(definition.parent_skill_id, (select auth.uid()))
    )
  );

create policy "Managers can remove draft composite components"
  on public.skill_composite_components for delete
  to authenticated
  using (
    exists (
      select 1
      from public.skill_composite_definitions definition
      where definition.id = skill_composite_components.definition_id
        and definition.status = 'draft'
        and public.can_manage_skill_composite(definition.parent_skill_id, (select auth.uid()))
    )
  );

-- Publishing a composition makes its provider-owned parent/components
-- readable as part of that published framework without exposing unrelated
-- skills from the same provider.
create policy "Authenticated users can view skills in published composites"
  on public.skill_library for select
  to authenticated
  using (
    exists (
      select 1
      from public.skill_composite_definitions definition
      where definition.parent_skill_id = skill_library.id
        and definition.status = 'published'
    )
    or exists (
      select 1
      from public.skill_composite_components component
      join public.skill_composite_definitions definition
        on definition.id = component.definition_id
      where component.component_skill_id = skill_library.id
        and definition.status = 'published'
    )
  );

grant select on table public.skill_composite_definitions to authenticated;
grant select, insert, update, delete on table public.skill_composite_components to authenticated;

comment on table public.skill_composite_definitions is
  'Versioned definitions that compose independently reusable library skills into a broader skill.';
comment on column public.skill_composite_components.contribution_weight is
  'Relative weight reserved for derived-progress calculations; phase one displays component coverage only.';
