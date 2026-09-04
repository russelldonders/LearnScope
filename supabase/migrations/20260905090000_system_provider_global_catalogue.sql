-- Make ORG-00001 the permanent system provider. Its Global catalogue is
-- the explicit source for learner-facing courses and skills; other provider
-- catalogues remain available inside their own scoped workspaces.

alter table public.organisations
  add column is_system boolean not null default false;

alter table public.catalogues
  drop constraint catalogues_check;

-- Production already has ORG-00001. A fresh local/test database does not,
-- so bootstrap the same stable provider identity there as well.
insert into public.organisations (name, type, status, org_code, is_system)
select 'LearnScope', 'provider', 'active', 'ORG-00001', true
where not exists (
  select 1 from public.organisations where org_code = 'ORG-00001'
);

select setval(
  'public.organisation_code_seq',
  greatest(
    coalesce((select max(substring(org_code from 5)::bigint) from public.organisations), 1),
    1
  ),
  true
);

do $$
declare
  v_system_organisation_id uuid;
begin
  select id into v_system_organisation_id
  from public.organisations
  where org_code = 'ORG-00001';

  if v_system_organisation_id is null then
    raise exception 'ORG-00001 must exist before installing the system-provider migration';
  end if;

  update public.organisations
  set is_system = true,
      type = 'provider',
      status = 'active',
      updated_at = now()
  where id = v_system_organisation_id;

  -- The catalogue started life before catalogues had organisational
  -- ownership. It now belongs to the system provider like every other
  -- catalogue belongs to its provider.
  update public.catalogues
  set organisation_id = v_system_organisation_id,
      updated_at = now()
  where is_global;

  -- Preserve today's learner skill library when the app switches to an
  -- explicit Global-catalogue membership query.
  insert into public.organisation_offered_skills
    (organisation_id, skill_library_id, created_by)
  select v_system_organisation_id, skill.id, skill.created_by
  from public.skill_library skill
  where not skill.is_private and skill.organisation_id is null
  on conflict (organisation_id, skill_library_id) do nothing;

  insert into public.catalogue_skills
    (catalogue_id, skill_library_id, created_by)
  select catalogue.id, skill.id, skill.created_by
  from public.catalogues catalogue
  cross join public.skill_library skill
  where catalogue.is_global
    and not skill.is_private
    and skill.organisation_id is null
  on conflict (catalogue_id, skill_library_id) do nothing;
end
$$;

alter table public.catalogues
  add constraint catalogues_organisation_required_check
    check (organisation_id is not null);

alter table public.organisations
  add constraint organisations_system_identity_check
    check (is_system = (org_code = 'ORG-00001'));

create unique index organisations_one_system_provider_idx
  on public.organisations (is_system)
  where is_system;

create or replace function public.protect_system_provider()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and old.is_system then
    raise exception 'The system provider cannot be deleted';
  end if;

  if tg_op = 'UPDATE' and old.is_system and (
    not new.is_system
    or new.org_code is distinct from old.org_code
    or new.type <> 'provider'
    or new.status <> 'active'
  ) then
    raise exception 'The system provider identity and active status cannot be changed';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.protect_system_provider() from public;

create trigger protect_system_provider_trigger
  before update or delete on public.organisations
  for each row execute procedure public.protect_system_provider();

create or replace function public.protect_global_catalogue()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and old.is_global then
    raise exception 'The Global catalogue cannot be deleted';
  end if;

  if tg_op = 'UPDATE' and old.is_global and (
    not new.is_global
    or new.organisation_id is distinct from old.organisation_id
  ) then
    raise exception 'The Global catalogue owner and system status cannot be changed';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.protect_global_catalogue() from public;

create trigger protect_global_catalogue_trigger
  before update or delete on public.catalogues
  for each row execute procedure public.protect_global_catalogue();

-- Learners can resolve exactly the skills curated into the Global catalogue.
create policy "Authenticated users can view Global catalogue skills"
  on public.catalogue_skills for select
  to authenticated
  using (
    exists (
      select 1 from public.catalogues catalogue
      where catalogue.id = catalogue_skills.catalogue_id
        and catalogue.is_global
    )
  );

drop policy "View public, personal, own organisation's, or platform-admin-visible skill library entries"
  on public.skill_library;

create policy "View public, personal, own organisation's, catalogued, or platform-admin-visible skills"
  on public.skill_library for select
  to authenticated
  using (
    is_platform_admin((select auth.uid()))
    or (organisation_id is null and (not is_private or created_by = (select auth.uid())))
    or (
      organisation_id is not null
      and (
        is_org_member(organisation_id, (select auth.uid()))
        or exists (
          select 1 from public.course_catalogue_skills course_skill
          join public.course_catalogue course on course.id = course_skill.course_catalogue_id
          where course_skill.skill_library_id = skill_library.id
            and course.status = 'approved'
        )
        or exists (
          select 1 from public.catalogue_skills catalogue_skill
          join public.catalogues catalogue on catalogue.id = catalogue_skill.catalogue_id
          where catalogue_skill.skill_library_id = skill_library.id
            and catalogue.is_global
        )
      )
    )
  );

comment on column public.organisations.is_system is
  'True only for ORG-00001, the permanent provider that owns the Global catalogue used by learner-facing discovery.';
