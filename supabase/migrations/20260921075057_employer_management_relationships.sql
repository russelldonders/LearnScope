-- Employer-contextual reporting and management relationships.
--
-- employer_members is the existing employment context and remains the source
-- of truth for a person's membership of an employer.  This table relates two
-- memberships from the same employer; it deliberately does not reuse the
-- independent, learner-consented manager_teams feature.

create table public.employer_management_relationships (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers(id) on delete cascade,
  manager_member_id uuid not null references public.employer_members(id) on delete cascade,
  employee_member_id uuid not null references public.employer_members(id) on delete cascade,
  relationship_type text not null
    check (relationship_type in ('primary', 'functional', 'project', 'delegate')),
  is_primary boolean not null default false,
  include_indirect_reports boolean not null default false,
  access_scope text[] not null,
  valid_from date not null default current_date,
  valid_until date,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employer_management_relationship_distinct_members
    check (manager_member_id <> employee_member_id),
  constraint employer_management_relationship_primary_flag
    check (not is_primary or relationship_type = 'primary'),
  constraint employer_management_relationship_dates
    check (valid_until is null or valid_until >= valid_from),
  constraint employer_management_relationship_scope
    check (
      cardinality(access_scope) > 0
      and array_position(access_scope, null) is null
      and access_scope <@ array[
        'employment',
        'role_assignments',
        'training_assignments',
        'skill_management',
        'shared_skills',
        'shared_skill_evidence',
        'shared_training',
        'shared_experience'
      ]::text[]
      and (
        not ('shared_skill_evidence' = any(access_scope))
        or 'shared_skills' = any(access_scope)
      )
    )
);

create index employer_management_relationships_manager_idx
  on public.employer_management_relationships
  (manager_member_id, employer_id, valid_from, valid_until);
create index employer_management_relationships_employee_idx
  on public.employer_management_relationships
  (employee_member_id, employer_id, valid_from, valid_until);
create index employer_management_relationships_primary_hierarchy_idx
  on public.employer_management_relationships
  (employer_id, manager_member_id, employee_member_id)
  where relationship_type = 'primary';

-- Serialise validations for one employer.  Relationship writes are rare and
-- admin-only; this prevents concurrent inserts from bypassing the overlap,
-- single-primary, or cycle checks without imposing locks on unrelated tenants.
create or replace function private.validate_employer_management_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manager_employer uuid;
  v_manager_status text;
  v_employee_employer uuid;
  v_employee_status text;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.employer_id::text, 0)
  );

  select em.employer_id, em.status
    into v_manager_employer, v_manager_status
  from public.employer_members em
  where em.id = new.manager_member_id;

  select em.employer_id, em.status
    into v_employee_employer, v_employee_status
  from public.employer_members em
  where em.id = new.employee_member_id;

  if v_manager_employer is distinct from new.employer_id
     or v_employee_employer is distinct from new.employer_id then
    raise exception 'Manager and employee must belong to the same employer';
  end if;

  if v_manager_status <> 'active' or v_employee_status <> 'active' then
    raise exception 'Manager and employee memberships must be active';
  end if;

  select array_agg(scope_name order by scope_name)
    into new.access_scope
  from (
    select distinct unnest(new.access_scope) as scope_name
  ) scopes;

  if exists (
    select 1
    from public.employer_management_relationships existing
    where existing.id <> coalesce(new.id, gen_random_uuid())
      and existing.employer_id = new.employer_id
      and existing.manager_member_id = new.manager_member_id
      and existing.employee_member_id = new.employee_member_id
      and existing.relationship_type = new.relationship_type
      and daterange(existing.valid_from, existing.valid_until, '[)')
          && daterange(new.valid_from, new.valid_until, '[)')
  ) then
    raise exception 'An overlapping relationship of this type already exists';
  end if;

  if new.is_primary and exists (
    select 1
    from public.employer_management_relationships existing
    where existing.id <> coalesce(new.id, gen_random_uuid())
      and existing.employer_id = new.employer_id
      and existing.employee_member_id = new.employee_member_id
      and existing.is_primary
      and daterange(existing.valid_from, existing.valid_until, '[)')
          && daterange(new.valid_from, new.valid_until, '[)')
  ) then
    raise exception 'An employee can have only one designated primary manager at a time';
  end if;

  if new.relationship_type = 'primary' and exists (
    with recursive descendants(member_id, overlap_from, overlap_until, path) as (
      select
        new.employee_member_id,
        new.valid_from,
        coalesce(new.valid_until, 'infinity'::date),
        array[new.employee_member_id]
      union all
      select
        relationship.employee_member_id,
        greatest(descendants.overlap_from, relationship.valid_from),
        least(descendants.overlap_until, coalesce(relationship.valid_until, 'infinity'::date)),
        descendants.path || relationship.employee_member_id
      from descendants
      join public.employer_management_relationships relationship
        on relationship.employer_id = new.employer_id
       and relationship.manager_member_id = descendants.member_id
       and relationship.relationship_type = 'primary'
       and relationship.id <> coalesce(new.id, gen_random_uuid())
       and relationship.employee_member_id <> all(descendants.path)
       and greatest(descendants.overlap_from, relationship.valid_from)
           < least(descendants.overlap_until, coalesce(relationship.valid_until, 'infinity'::date))
    )
    select 1
    from descendants
    where member_id = new.manager_member_id
      and overlap_from < overlap_until
  ) then
    raise exception 'Primary management relationships cannot contain a cycle';
  end if;

  new.updated_at := now();
  return new;
end
$$;

revoke all on function private.validate_employer_management_relationship() from public, anon, authenticated;

create trigger validate_employer_management_relationship_trigger
  before insert or update on public.employer_management_relationships
  for each row execute procedure private.validate_employer_management_relationship();

-- Internal helpers use SECURITY DEFINER to avoid recursive RLS evaluation.
-- Every caller supplies the acting user explicitly, and public RPCs below
-- always bind that value to auth.uid().
create or replace function private.has_employer_management_scope(
  p_manager_user_id uuid,
  p_employer_id uuid,
  p_scope text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_manager_user_id = auth.uid() and exists (
    select 1
    from public.employer_management_relationships relationship
    join public.employer_members manager_member
      on manager_member.id = relationship.manager_member_id
    join public.employer_members employee_member
      on employee_member.id = relationship.employee_member_id
    where manager_member.user_id = p_manager_user_id
      and manager_member.status = 'active'
      and employee_member.status = 'active'
      and (p_employer_id is null or relationship.employer_id = p_employer_id)
      and p_scope = any(relationship.access_scope)
      and relationship.valid_from <= current_date
      and (relationship.valid_until is null or relationship.valid_until > current_date)
  )
$$;

create or replace function private.can_manage_employer_member(
  p_manager_user_id uuid,
  p_employee_member_id uuid,
  p_scope text default null,
  p_allow_indirect boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_manager_user_id = auth.uid() and (
    exists (
      select 1
      from public.employer_management_relationships relationship
      join public.employer_members manager_member
        on manager_member.id = relationship.manager_member_id
       and manager_member.status = 'active'
      join public.employer_members employee_member
        on employee_member.id = relationship.employee_member_id
       and employee_member.status = 'active'
      where manager_member.user_id = p_manager_user_id
        and relationship.employee_member_id = p_employee_member_id
        and (p_scope is null or p_scope = any(relationship.access_scope))
        and relationship.valid_from <= current_date
        and (relationship.valid_until is null or relationship.valid_until > current_date)
    )
    or (
      p_allow_indirect
      and exists (
        with recursive reports(employee_member_id, employer_id, path) as (
          select
            relationship.employee_member_id,
            relationship.employer_id,
            array[relationship.manager_member_id, relationship.employee_member_id]
          from public.employer_management_relationships relationship
          join public.employer_members manager_member
            on manager_member.id = relationship.manager_member_id
           and manager_member.status = 'active'
          join public.employer_members employee_member
            on employee_member.id = relationship.employee_member_id
           and employee_member.status = 'active'
          where manager_member.user_id = p_manager_user_id
            and relationship.include_indirect_reports
            and (p_scope is null or p_scope = any(relationship.access_scope))
            and relationship.valid_from <= current_date
            and (relationship.valid_until is null or relationship.valid_until > current_date)

          union all

          select
            relationship.employee_member_id,
            reports.employer_id,
            reports.path || relationship.employee_member_id
          from reports
          join public.employer_management_relationships relationship
            on relationship.employer_id = reports.employer_id
           and relationship.manager_member_id = reports.employee_member_id
           and relationship.relationship_type = 'primary'
           and relationship.valid_from <= current_date
           and (relationship.valid_until is null or relationship.valid_until > current_date)
           and relationship.employee_member_id <> all(reports.path)
          join public.employer_members employee_member
            on employee_member.id = relationship.employee_member_id
           and employee_member.status = 'active'
        )
        select 1 from reports where employee_member_id = p_employee_member_id
      )
    )
  )
$$;

create or replace function private.can_manage_employer_user(
  p_manager_user_id uuid,
  p_employee_user_id uuid,
  p_employer_id uuid,
  p_scope text,
  p_allow_indirect boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_manager_user_id = auth.uid() and exists (
    select 1
    from public.employer_members employee_member
    where employee_member.employer_id = p_employer_id
      and employee_member.user_id = p_employee_user_id
      and employee_member.status = 'active'
      and private.can_manage_employer_member(
        p_manager_user_id,
        employee_member.id,
        p_scope,
        p_allow_indirect
      )
  )
$$;

revoke all on function private.has_employer_management_scope(uuid, uuid, text) from public, anon;
revoke all on function private.can_manage_employer_member(uuid, uuid, text, boolean) from public, anon;
revoke all on function private.can_manage_employer_user(uuid, uuid, uuid, text, boolean) from public, anon;
grant execute on function private.has_employer_management_scope(uuid, uuid, text) to authenticated;
grant execute on function private.can_manage_employer_member(uuid, uuid, text, boolean) to authenticated;
grant execute on function private.can_manage_employer_user(uuid, uuid, uuid, text, boolean) to authenticated;

alter table public.employer_management_relationships enable row level security;

revoke all on table public.employer_management_relationships from anon, authenticated;

create policy "Relationship parties and employer admins can view management relationships"
  on public.employer_management_relationships for select
  to authenticated
  using (
    public.is_employer_admin(employer_id, (select auth.uid()))
    or exists (
      select 1
      from public.employer_members participant
      where participant.id in (manager_member_id, employee_member_id)
        and participant.user_id = (select auth.uid())
        and participant.status = 'active'
    )
  );

grant select on public.employer_management_relationships to authenticated;

-- Relationship writes are RPC-only.  This keeps effective-date, tenant, and
-- cycle validation on the server even when a caller bypasses the future UI.
create or replace function public.create_employer_management_relationship(
  p_employer_id uuid,
  p_manager_member_id uuid,
  p_employee_member_id uuid,
  p_relationship_type text,
  p_is_primary boolean,
  p_include_indirect_reports boolean,
  p_access_scope text[],
  p_valid_from date default current_date,
  p_valid_until date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_relationship_id uuid;
begin
  if auth.uid() is null or not public.is_employer_admin(p_employer_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;

  insert into public.employer_management_relationships (
    employer_id,
    manager_member_id,
    employee_member_id,
    relationship_type,
    is_primary,
    include_indirect_reports,
    access_scope,
    valid_from,
    valid_until,
    created_by
  ) values (
    p_employer_id,
    p_manager_member_id,
    p_employee_member_id,
    p_relationship_type,
    p_is_primary,
    p_include_indirect_reports,
    p_access_scope,
    p_valid_from,
    p_valid_until,
    auth.uid()
  ) returning id into v_relationship_id;

  return v_relationship_id;
end
$$;

create or replace function public.update_employer_management_relationship(
  p_relationship_id uuid,
  p_relationship_type text,
  p_is_primary boolean,
  p_include_indirect_reports boolean,
  p_access_scope text[],
  p_valid_from date,
  p_valid_until date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_employer_id uuid;
begin
  select relationship.employer_id into v_employer_id
  from public.employer_management_relationships relationship
  where relationship.id = p_relationship_id;

  if v_employer_id is null or not public.is_employer_admin(v_employer_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;

  update public.employer_management_relationships
  set relationship_type = p_relationship_type,
      is_primary = p_is_primary,
      include_indirect_reports = p_include_indirect_reports,
      access_scope = p_access_scope,
      valid_from = p_valid_from,
      valid_until = p_valid_until
  where id = p_relationship_id;
end
$$;

create or replace function public.end_employer_management_relationship(
  p_relationship_id uuid,
  p_valid_until date default current_date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_employer_id uuid;
begin
  select relationship.employer_id into v_employer_id
  from public.employer_management_relationships relationship
  where relationship.id = p_relationship_id;

  if v_employer_id is null or not public.is_employer_admin(v_employer_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;

  if p_valid_until is null then
    raise exception 'An end date is required';
  end if;

  update public.employer_management_relationships
  set valid_until = p_valid_until
  where id = p_relationship_id;
end
$$;

revoke all on function public.create_employer_management_relationship(uuid, uuid, uuid, text, boolean, boolean, text[], date, date) from public, anon;
revoke all on function public.update_employer_management_relationship(uuid, text, boolean, boolean, text[], date, date) from public, anon;
revoke all on function public.end_employer_management_relationship(uuid, date) from public, anon;
grant execute on function public.create_employer_management_relationship(uuid, uuid, uuid, text, boolean, boolean, text[], date, date) to authenticated;
grant execute on function public.update_employer_management_relationship(uuid, text, boolean, boolean, text[], date, date) to authenticated;
grant execute on function public.end_employer_management_relationship(uuid, date) to authenticated;

-- Caller-scoped hierarchy APIs.  Employer admins do not receive an implicit
-- positive result: a manager is defined only by an active relationship.
create or replace function public.can_manage_employer_member(
  p_employee_member_id uuid,
  p_scope text default null,
  p_allow_indirect boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and private.can_manage_employer_member(
      auth.uid(),
      p_employee_member_id,
      p_scope,
      p_allow_indirect
    )
$$;

create or replace function public.list_employer_direct_reports(p_employer_id uuid)
returns table (
  relationship_id uuid,
  employee_member_id uuid,
  employee_user_id uuid,
  relationship_type text,
  is_primary boolean,
  include_indirect_reports boolean,
  access_scope text[],
  valid_from date,
  valid_until date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    relationship.id,
    employee_member.id,
    employee_member.user_id,
    relationship.relationship_type,
    relationship.is_primary,
    relationship.include_indirect_reports,
    relationship.access_scope,
    relationship.valid_from,
    relationship.valid_until
  from public.employer_management_relationships relationship
  join public.employer_members manager_member
    on manager_member.id = relationship.manager_member_id
   and manager_member.status = 'active'
  join public.employer_members employee_member
    on employee_member.id = relationship.employee_member_id
   and employee_member.status = 'active'
  where relationship.employer_id = p_employer_id
    and manager_member.user_id = auth.uid()
    and relationship.valid_from <= current_date
    and (relationship.valid_until is null or relationship.valid_until > current_date)
  order by employee_member.id, relationship.relationship_type, relationship.id
$$;

create or replace function public.list_employer_indirect_reports(p_employer_id uuid)
returns table (
  employee_member_id uuid,
  employee_user_id uuid,
  report_depth integer,
  originating_relationship_id uuid,
  access_scope text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive reports(
    employee_member_id,
    report_depth,
    originating_relationship_id,
    access_scope,
    path
  ) as (
    select
      relationship.employee_member_id,
      1,
      relationship.id,
      relationship.access_scope,
      array[relationship.manager_member_id, relationship.employee_member_id]
    from public.employer_management_relationships relationship
    join public.employer_members manager_member
      on manager_member.id = relationship.manager_member_id
     and manager_member.status = 'active'
    join public.employer_members employee_member
      on employee_member.id = relationship.employee_member_id
     and employee_member.status = 'active'
    where relationship.employer_id = p_employer_id
      and manager_member.user_id = auth.uid()
      and relationship.include_indirect_reports
      and relationship.valid_from <= current_date
      and (relationship.valid_until is null or relationship.valid_until > current_date)

    union all

    select
      relationship.employee_member_id,
      reports.report_depth + 1,
      reports.originating_relationship_id,
      reports.access_scope,
      reports.path || relationship.employee_member_id
    from reports
    join public.employer_management_relationships relationship
      on relationship.employer_id = p_employer_id
     and relationship.manager_member_id = reports.employee_member_id
     and relationship.relationship_type = 'primary'
     and relationship.valid_from <= current_date
     and (relationship.valid_until is null or relationship.valid_until > current_date)
     and relationship.employee_member_id <> all(reports.path)
    join public.employer_members employee_member
      on employee_member.id = relationship.employee_member_id
     and employee_member.status = 'active'
  )
  select
    reports.employee_member_id,
    employee_member.user_id,
    reports.report_depth,
    reports.originating_relationship_id,
    reports.access_scope
  from reports
  join public.employer_members employee_member
    on employee_member.id = reports.employee_member_id
  where reports.report_depth > 1
  order by reports.report_depth, reports.employee_member_id, reports.originating_relationship_id
$$;

create or replace function public.list_manageable_employer_members(p_employer_id uuid)
returns table (
  employee_member_id uuid,
  employee_user_id uuid,
  report_depth integer,
  access_scope text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive reports(employee_member_id, report_depth, access_scope, path, may_descend) as (
    select
      relationship.employee_member_id,
      1,
      relationship.access_scope,
      array[relationship.manager_member_id, relationship.employee_member_id],
      relationship.include_indirect_reports
    from public.employer_management_relationships relationship
    join public.employer_members manager_member
      on manager_member.id = relationship.manager_member_id
     and manager_member.status = 'active'
    join public.employer_members employee_member
      on employee_member.id = relationship.employee_member_id
     and employee_member.status = 'active'
    where relationship.employer_id = p_employer_id
      and manager_member.user_id = auth.uid()
      and relationship.valid_from <= current_date
      and (relationship.valid_until is null or relationship.valid_until > current_date)

    union all

    select
      relationship.employee_member_id,
      reports.report_depth + 1,
      reports.access_scope,
      reports.path || relationship.employee_member_id,
      true
    from reports
    join public.employer_management_relationships relationship
      on reports.may_descend
     and relationship.employer_id = p_employer_id
     and relationship.manager_member_id = reports.employee_member_id
     and relationship.relationship_type = 'primary'
     and relationship.valid_from <= current_date
     and (relationship.valid_until is null or relationship.valid_until > current_date)
     and relationship.employee_member_id <> all(reports.path)
    join public.employer_members employee_member
      on employee_member.id = relationship.employee_member_id
     and employee_member.status = 'active'
  ), flattened as (
    select reports.employee_member_id, reports.report_depth, scope_name
    from reports
    cross join lateral unnest(reports.access_scope) scope_name
  )
  select
    flattened.employee_member_id,
    employee_member.user_id,
    min(flattened.report_depth)::integer,
    array_agg(distinct flattened.scope_name order by flattened.scope_name)
  from flattened
  join public.employer_members employee_member
    on employee_member.id = flattened.employee_member_id
  group by flattened.employee_member_id, employee_member.user_id
  order by min(flattened.report_depth), flattened.employee_member_id
$$;

create or replace function public.list_employer_member_managers(p_employee_member_id uuid)
returns table (
  relationship_id uuid,
  manager_member_id uuid,
  manager_user_id uuid,
  relationship_type text,
  is_primary boolean,
  include_indirect_reports boolean,
  access_scope text[],
  valid_from date,
  valid_until date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employer_id uuid;
  v_employee_user_id uuid;
begin
  select member.employer_id, member.user_id
    into v_employer_id, v_employee_user_id
  from public.employer_members member
  where member.id = p_employee_member_id and member.status = 'active';

  if v_employer_id is null or not (
    v_employee_user_id = auth.uid()
    or public.is_employer_admin(v_employer_id, auth.uid())
    or private.can_manage_employer_member(auth.uid(), p_employee_member_id, 'employment', true)
  ) then
    raise exception 'Not authorised';
  end if;

  return query
  select
    relationship.id,
    manager_member.id,
    manager_member.user_id,
    relationship.relationship_type,
    relationship.is_primary,
    relationship.include_indirect_reports,
    relationship.access_scope,
    relationship.valid_from,
    relationship.valid_until
  from public.employer_management_relationships relationship
  join public.employer_members manager_member
    on manager_member.id = relationship.manager_member_id
   and manager_member.status = 'active'
  where relationship.employee_member_id = p_employee_member_id
    and relationship.valid_from <= current_date
    and (relationship.valid_until is null or relationship.valid_until > current_date)
  order by relationship.is_primary desc, relationship.relationship_type, relationship.id;
end
$$;

revoke all on function public.can_manage_employer_member(uuid, text, boolean) from public, anon;
revoke all on function public.list_employer_direct_reports(uuid) from public, anon;
revoke all on function public.list_employer_indirect_reports(uuid) from public, anon;
revoke all on function public.list_manageable_employer_members(uuid) from public, anon;
revoke all on function public.list_employer_member_managers(uuid) from public, anon;
grant execute on function public.can_manage_employer_member(uuid, text, boolean) to authenticated;
grant execute on function public.list_employer_direct_reports(uuid) to authenticated;
grant execute on function public.list_employer_indirect_reports(uuid) to authenticated;
grant execute on function public.list_manageable_employer_members(uuid) to authenticated;
grant execute on function public.list_employer_member_managers(uuid) to authenticated;

-- Employer-owned data.  These are additive SELECT paths only; managers gain
-- no admin mutation privileges.
grant select on public.employer_field_definitions,
  public.employer_member_field_values to authenticated;

create policy "Scoped managers can view report field definitions"
  on public.employer_field_definitions for select
  to authenticated
  using (
    private.has_employer_management_scope(
      (select auth.uid()),
      employer_id,
      'employment'
    )
  );

create policy "Scoped managers can view report field values"
  on public.employer_member_field_values for select
  to authenticated
  using (
    private.can_manage_employer_member(
      (select auth.uid()),
      employer_member_id,
      'employment',
      true
    )
  );

create policy "Scoped managers can view report role assignments"
  on public.employer_role_assignments for select
  to authenticated
  using (
    private.can_manage_employer_member(
      (select auth.uid()),
      employer_member_id,
      'role_assignments',
      true
    )
  );

create policy "Scoped managers can view report training assignments"
  on public.course_assignments for select
  to authenticated
  using (
    private.can_manage_employer_user(
      (select auth.uid()),
      assigned_to,
      employer_id,
      'training_assignments',
      true
    )
  );

create policy "Scoped managers can view report skill suggestions"
  on public.employer_skill_suggestions for select
  to authenticated
  using (
    private.can_manage_employer_user(
      (select auth.uid()),
      learner_id,
      employer_id,
      'skill_management',
      true
    )
  );

create policy "Scoped managers can view report skill confirmations"
  on public.employer_skill_confirmations for select
  to authenticated
  using (
    private.can_manage_employer_user(
      (select auth.uid()),
      user_id,
      employer_id,
      'skill_management',
      true
    )
  );

-- Learner-owned data remains behind the learner's existing, employer-specific
-- grant.  The manager must additionally have the matching relationship scope.
create or replace function public.is_skill_shared_with_employer(
  p_skill_id uuid,
  p_check_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_check_user_id = auth.uid() and exists (
    select 1
    from public.employer_data_access_shared_skills shared_skill
    join public.employer_data_access_requests request
      on request.id = shared_skill.request_id
    join public.skills skill
      on skill.id = shared_skill.skill_id
     and skill.user_id = request.learner_id
    where shared_skill.skill_id = p_skill_id
      and request.status = 'approved'
      and 'skills' = any(request.approved_data)
      and public.is_employer_member(request.employer_id, request.learner_id)
      and (
        public.is_employer_admin(request.employer_id, p_check_user_id)
        or private.can_manage_employer_user(
          p_check_user_id,
          request.learner_id,
          request.employer_id,
          'shared_skills',
          true
        )
      )
  )
$$;

create or replace function public.is_skill_evidence_shared_with_employer(
  p_skill_id uuid,
  p_check_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_check_user_id = auth.uid() and exists (
    select 1
    from public.employer_data_access_shared_skills shared_skill
    join public.employer_data_access_requests request
      on request.id = shared_skill.request_id
    join public.skills skill
      on skill.id = shared_skill.skill_id
     and skill.user_id = request.learner_id
    where shared_skill.skill_id = p_skill_id
      and request.status = 'approved'
      and 'skills' = any(request.approved_data)
      and public.is_employer_member(request.employer_id, request.learner_id)
      and (
        public.is_employer_admin(request.employer_id, p_check_user_id)
        or private.can_manage_employer_user(
          p_check_user_id,
          request.learner_id,
          request.employer_id,
          'shared_skill_evidence',
          true
        )
      )
  )
$$;

revoke all on function public.is_skill_shared_with_employer(uuid, uuid) from public, anon;
revoke all on function public.is_skill_evidence_shared_with_employer(uuid, uuid) from public, anon;
grant execute on function public.is_skill_shared_with_employer(uuid, uuid) to authenticated;
grant execute on function public.is_skill_evidence_shared_with_employer(uuid, uuid) to authenticated;

drop policy "Employers with granted access can view skill assessments"
  on public.skill_assessments;
create policy "Employers with granted access can view skill assessments"
  on public.skill_assessments for select
  to authenticated
  using (
    public.is_skill_evidence_shared_with_employer(
      skill_assessments.skill_id,
      (select auth.uid())
    )
  );

create or replace function public.has_employer_category_access(
  p_learner_id uuid,
  p_category text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employer_data_access_requests request
    where request.learner_id = p_learner_id
      and request.status = 'approved'
      and p_category = any(request.approved_data)
      and public.is_employer_member(request.employer_id, request.learner_id)
      and (
        public.is_employer_admin(request.employer_id, auth.uid())
        or private.can_manage_employer_user(
          auth.uid(),
          request.learner_id,
          request.employer_id,
          case p_category
            when 'training' then 'shared_training'
            when 'experience' then 'shared_experience'
            else '__unsupported__'
          end,
          true
        )
      )
  )
$$;

revoke all on function public.has_employer_category_access(uuid, text) from public, anon;
grant execute on function public.has_employer_category_access(uuid, text) to authenticated;

create policy "Scoped managers can read explicitly shared skill evidence files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'skill-evidence'
    and exists (
      select 1
      from public.skill_assessments assessment
      where name = any(coalesce(assessment.evidence_paths, array[]::text[]))
        and public.is_skill_evidence_shared_with_employer(
          assessment.skill_id,
          (select auth.uid())
        )
    )
  );
