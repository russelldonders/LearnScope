-- Make organisations the sole persisted business identity. "Employer" now
-- describes a workforce relationship/capability, not a second entity type.

-- Preserve the old-to-canonical id mapping while dependent rows are moved.
create temporary table canonical_organisation_map on commit drop as
select id as legacy_employer_id, provider_organisation_id as organisation_id
from public.employers;

-- Ensure every former employer organisation advertises its workforce role.
insert into public.organisation_capabilities (organisation_id, capability)
select m.organisation_id, capability
from canonical_organisation_map m
cross join lateral (
  values ('employs_people'), ('manages_workforce_development')
) capabilities(capability)
on conflict (organisation_id, capability) do update set status = 'active';

-- Keep the canonical organisation's public identity complete before the
-- duplicate record is removed.
update public.organisations o
set name = e.name,
    created_by = coalesce(o.created_by, e.created_by),
    updated_at = greatest(o.updated_at, e.updated_at)
from public.employers e
where o.id = e.provider_organisation_id;

-- The organisation-capability policy was the sole external schema dependency
-- on the employers table. It is recreated against canonical memberships below.
drop policy if exists "Members can view their organisation capabilities"
  on public.organisation_capabilities;

drop function if exists public.create_employer(text);

alter table public.course_assignments drop constraint course_assignments_employer_id_fkey;
alter table public.employer_catalogue_access drop constraint employer_catalogue_access_employer_id_fkey;
alter table public.employer_data_access_requests drop constraint employer_data_access_requests_employer_id_fkey;
alter table public.employer_field_definitions drop constraint employer_field_definitions_employer_id_fkey;
alter table public.employer_linked_providers drop constraint employer_linked_providers_employer_id_fkey;
alter table public.employer_management_relationships drop constraint employer_management_relationships_employer_id_fkey;
alter table public.employer_members drop constraint employer_members_employer_id_fkey;
alter table public.employer_role_profiles drop constraint employer_role_profiles_employer_id_fkey;
alter table public.employer_skill_confirmations drop constraint employer_skill_confirmations_employer_id_fkey;
alter table public.employer_skill_development_targets drop constraint employer_skill_development_targets_employer_id_fkey;
alter table public.employer_skill_suggestions drop constraint employer_skill_suggestions_employer_id_fkey;
alter table public.learning_profiles drop constraint learning_profiles_employer_id_fkey;
alter table public.person_auth_accounts drop constraint person_auth_accounts_employer_id_fkey;

update public.course_assignments t set employer_id = m.organisation_id from canonical_organisation_map m where t.employer_id = m.legacy_employer_id;
update public.employer_catalogue_access t set employer_id = m.organisation_id from canonical_organisation_map m where t.employer_id = m.legacy_employer_id;
update public.employer_data_access_requests t set employer_id = m.organisation_id from canonical_organisation_map m where t.employer_id = m.legacy_employer_id;
update public.employer_field_definitions t set employer_id = m.organisation_id from canonical_organisation_map m where t.employer_id = m.legacy_employer_id;
update public.employer_linked_providers t set employer_id = m.organisation_id from canonical_organisation_map m where t.employer_id = m.legacy_employer_id;
update public.employer_management_relationships t set employer_id = m.organisation_id from canonical_organisation_map m where t.employer_id = m.legacy_employer_id;
update public.employer_members t set employer_id = m.organisation_id from canonical_organisation_map m where t.employer_id = m.legacy_employer_id;
update public.employer_role_profiles t set employer_id = m.organisation_id from canonical_organisation_map m where t.employer_id = m.legacy_employer_id;
update public.employer_skill_confirmations t set employer_id = m.organisation_id from canonical_organisation_map m where t.employer_id = m.legacy_employer_id;
update public.employer_skill_development_targets t set employer_id = m.organisation_id from canonical_organisation_map m where t.employer_id = m.legacy_employer_id;
update public.employer_skill_suggestions t set employer_id = m.organisation_id from canonical_organisation_map m where t.employer_id = m.legacy_employer_id;
update public.learning_profiles t set employer_id = m.organisation_id from canonical_organisation_map m where t.employer_id = m.legacy_employer_id;
update public.person_auth_accounts t set employer_id = m.organisation_id from canonical_organisation_map m where t.employer_id = m.legacy_employer_id;

alter table public.course_assignments add constraint course_assignments_organisation_fkey foreign key (employer_id) references public.organisations(id) on delete cascade;
alter table public.employer_catalogue_access add constraint employer_catalogue_access_organisation_fkey foreign key (employer_id) references public.organisations(id) on delete cascade;
alter table public.employer_data_access_requests add constraint employer_data_access_requests_organisation_fkey foreign key (employer_id) references public.organisations(id) on delete cascade;
alter table public.employer_field_definitions add constraint employer_field_definitions_organisation_fkey foreign key (employer_id) references public.organisations(id) on delete cascade;
alter table public.employer_linked_providers add constraint employer_linked_providers_organisation_fkey foreign key (employer_id) references public.organisations(id) on delete cascade;
alter table public.employer_management_relationships add constraint employer_management_relationships_organisation_fkey foreign key (employer_id) references public.organisations(id) on delete cascade;
alter table public.employer_members add constraint employer_members_organisation_fkey foreign key (employer_id) references public.organisations(id) on delete cascade;
alter table public.employer_role_profiles add constraint employer_role_profiles_organisation_fkey foreign key (employer_id) references public.organisations(id) on delete cascade;
alter table public.employer_skill_confirmations add constraint employer_skill_confirmations_organisation_fkey foreign key (employer_id) references public.organisations(id) on delete cascade;
alter table public.employer_skill_development_targets add constraint employer_skill_development_targets_organisation_fkey foreign key (employer_id) references public.organisations(id) on delete cascade;
alter table public.employer_skill_suggestions add constraint employer_skill_suggestions_organisation_fkey foreign key (employer_id) references public.organisations(id) on delete cascade;
alter table public.learning_profiles add constraint learning_profiles_organisation_fkey foreign key (employer_id) references public.organisations(id) on delete cascade;
alter table public.person_auth_accounts add constraint person_auth_accounts_organisation_fkey foreign key (employer_id) references public.organisations(id) on delete set null;

drop table public.employers;
drop sequence if exists public.employer_code_seq;
drop function if exists public.set_employer_code();
drop function if exists public.generate_employer_code();

-- No discriminator remains: capabilities compose an organisation's behaviour.
alter table public.organisations drop column if exists type;

-- Compatibility projection for the existing workforce SQL API. It contains no
-- separate identity or storage: id and provider_organisation_id are both the
-- canonical organisation id. New application code reads organisations.
create view public.employers
with (security_invoker = true)
as
select
  o.id,
  o.name,
  o.org_code as employer_code,
  o.id as provider_organisation_id,
  o.created_by,
  o.created_at,
  o.updated_at
from public.organisations o
where exists (
  select 1
  from public.organisation_capabilities oc
  where oc.organisation_id = o.id
    and oc.capability = 'employs_people'
    and oc.status = 'active'
);

revoke all on public.employers from public, anon;
grant select on public.employers to authenticated;

create policy "Members can view their organisation capabilities"
  on public.organisation_capabilities for select
  to authenticated
  using (
    exists (
      select 1 from public.organisation_members om
      where om.organisation_id = organisation_capabilities.organisation_id
        and om.user_id = (select auth.uid())
        and om.status = 'active'
    )
    or exists (
      select 1 from public.employer_members em
      where em.employer_id = organisation_capabilities.organisation_id
        and em.user_id = (select auth.uid())
        and em.status = 'active'
    )
    or exists (
      select 1 from public.platform_admins pa
      where pa.user_id = (select auth.uid())
    )
  );

-- Canonical creation API. Capabilities are validated and supplied explicitly;
-- workforce management implies employing people, and external supply implies
-- learning authoring.
-- These pre-existing trigger functions used the caller's search path. Pin them
-- before calling the hardened RPC (whose own search path is deliberately empty).
alter function public.set_organisation_slug() set search_path = public;
alter function public.generate_unique_organisation_slug(text, uuid) set search_path = public;

create or replace function public.create_organisation(
  p_name text,
  p_capabilities text[] default array[]::text[]
)
returns public.organisations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_organisation public.organisations;
  v_capability text;
  v_capabilities text[] := coalesce(p_capabilities, array[]::text[]);
begin
  if v_caller is null or not public.is_platform_admin(v_caller) then
    raise exception 'Not authorized';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Organisation name is required';
  end if;
  if exists (
    select 1 from unnest(v_capabilities) capability
    where capability not in ('employs_people', 'manages_workforce_development', 'authors_learning', 'supplies_learning_externally')
  ) then
    raise exception 'Unknown organisation capability';
  end if;

  if 'manages_workforce_development' = any(v_capabilities) and not ('employs_people' = any(v_capabilities)) then
    v_capabilities := array_append(v_capabilities, 'employs_people');
  end if;
  if 'supplies_learning_externally' = any(v_capabilities) and not ('authors_learning' = any(v_capabilities)) then
    v_capabilities := array_append(v_capabilities, 'authors_learning');
  end if;

  insert into public.organisations (name, created_by)
  values (btrim(p_name), v_caller)
  returning * into v_organisation;

  foreach v_capability in array v_capabilities loop
    insert into public.organisation_capabilities (organisation_id, capability, enabled_by)
    values (v_organisation.id, v_capability, v_caller)
    on conflict (organisation_id, capability) do update
      set status = 'active', enabled_by = excluded.enabled_by, enabled_at = now();
  end loop;

  return v_organisation;
end;
$$;

revoke all on function public.create_organisation(text, text[]) from public, anon;
grant execute on function public.create_organisation(text, text[]) to authenticated;

create or replace function public.set_organisation_capabilities(
  p_organisation_id uuid,
  p_capabilities text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_capability text;
  v_capabilities text[] := coalesce(p_capabilities, array[]::text[]);
begin
  if v_caller is null or not public.is_platform_admin(v_caller) then
    raise exception 'Not authorized';
  end if;
  if not exists (select 1 from public.organisations where id = p_organisation_id) then
    raise exception 'Organisation not found';
  end if;
  if exists (
    select 1 from unnest(v_capabilities) capability
    where capability not in ('employs_people', 'manages_workforce_development', 'authors_learning', 'supplies_learning_externally')
  ) then
    raise exception 'Unknown organisation capability';
  end if;

  if 'manages_workforce_development' = any(v_capabilities) and not ('employs_people' = any(v_capabilities)) then
    v_capabilities := array_append(v_capabilities, 'employs_people');
  end if;
  if 'supplies_learning_externally' = any(v_capabilities) and not ('authors_learning' = any(v_capabilities)) then
    v_capabilities := array_append(v_capabilities, 'authors_learning');
  end if;

  update public.organisation_capabilities
  set status = 'inactive'
  where organisation_id = p_organisation_id
    and not (capability = any(v_capabilities));

  foreach v_capability in array v_capabilities loop
    insert into public.organisation_capabilities (organisation_id, capability, enabled_by)
    values (p_organisation_id, v_capability, v_caller)
    on conflict (organisation_id, capability) do update
      set status = 'active', enabled_by = excluded.enabled_by, enabled_at = now();
  end loop;
end;
$$;

revoke all on function public.set_organisation_capabilities(uuid, text[]) from public, anon;
grant execute on function public.set_organisation_capabilities(uuid, text[]) to authenticated;

-- Transitional RPC alias for clients deployed during the cutover. It creates
-- only the canonical organisation and returns the compatibility view shape.
create or replace function public.create_employer(p_name text)
returns public.employers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organisation public.organisations;
  v_employer public.employers;
begin
  v_organisation := public.create_organisation(
    p_name,
    array['employs_people', 'manages_workforce_development', 'authors_learning']
  );
  select * into v_employer from public.employers where id = v_organisation.id;
  return v_employer;
end;
$$;

revoke all on function public.create_employer(text) from public, anon;
grant execute on function public.create_employer(text) to authenticated;
