-- Phase 1 foundation for the "employer" domain concept (CLAUDE.md future-
-- direction section): a company running its own in-house LMS, distinct from
-- "organisations" (which today are only ever training providers, staffed by
-- organisation_members). An employer gets its own dedicated,
-- auto-provisioned provider organisation "attached" underneath it, so it can
-- author its own courses/catalogues/resources through the *existing*
-- provider console/RLS model verbatim -- no duplication of that machinery.
-- employer_members is a separate, new membership concept for an employer's
-- own managed learners (not provider staff) -- deliberately NOT the same
-- table as organisation_members, since staffing the attached provider org
-- (who can author training) and belonging to the employer as a managed
-- learner are different relationships that will diverge in later phases
-- (bulk import, course assignment, consent-based data sharing).
--
-- Only foundation here: schema, RLS, and create_employer(). No bulk import,
-- no course assignment, no automatic RLS visibility into org-assigned
-- training, no learner-facing UI -- all explicitly later phases.

-- ----------------------------------------------------------------------------
-- Reference codes -- same generate-on-insert-if-null shape as 0113's
-- generate_organisation_code()/set_organisation_code().
-- ----------------------------------------------------------------------------

create sequence employer_code_seq;

create or replace function generate_employer_code()
returns text
language sql
as $$
  select 'EMP-' || lpad(nextval('employer_code_seq')::text, 5, '0')
$$;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table employers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  employer_code text,
  provider_organisation_id uuid not null references organisations(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function set_employer_code()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.employer_code is null then
    new.employer_code := generate_employer_code();
  end if;
  return new;
end;
$$;

create trigger set_employer_code_trigger
  before insert on employers
  for each row execute procedure set_employer_code();

create unique index employers_employer_code_unique_idx on employers (employer_code);

-- One attached provider org per employer, and one employer per provider org.
create unique index employers_provider_organisation_id_unique_idx on employers (provider_organisation_id);

create table employer_members (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references employers(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('admin', 'member')),
  status text not null default 'active' check (status in ('active', 'pending')),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (employer_id, user_id)
);

create index employer_members_employer_idx on employer_members (employer_id);
create index employer_members_user_idx on employer_members (user_id);

-- ----------------------------------------------------------------------------
-- Helper functions -- security definer/stable, mirroring is_org_admin/
-- is_org_member (0065) exactly, including the is_platform_admin OR-bypass
-- that lets a platform admin add the very first admin member to a
-- brand-new employer with no existing members yet (same chicken-and-egg
-- resolution organisation_members already relies on for its own insert
-- policy). The first parameter is named p_employer_id rather than
-- employer_id (unlike the brief's literal suggestion) because employer_id
-- is also a column name on employer_members -- 0065 avoided the identical
-- trap by naming its own parameter org_id rather than organisation_id;
-- reusing the column name here would make every unqualified employer_id
-- reference in the query ambiguous.
-- ----------------------------------------------------------------------------

create or replace function is_employer_admin(p_employer_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from employer_members
    where employer_id = p_employer_id and user_id = check_user_id and role = 'admin'
  ) or is_platform_admin(check_user_id)
$$;

grant execute on function is_employer_admin(uuid, uuid) to authenticated;

create or replace function is_employer_member(p_employer_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from employer_members
    where employer_id = p_employer_id and user_id = check_user_id
  ) or is_platform_admin(check_user_id)
$$;

grant execute on function is_employer_member(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table employers enable row level security;

-- Unlike organisations' "any authenticated user can view" (providers are a
-- public directory) -- employers are private company entities, so select is
-- scoped to members only.
create policy "Employer members can view their employer"
  on employers for select
  to authenticated
  using (is_employer_member(id, auth.uid()));

-- No insert policy -- creation only happens through create_employer() below
-- (security definer, platform-admin-gated), same as organisations having no
-- open insert path outside its own platform-admin-only policy.
create policy "Employer admins can update their employer"
  on employers for update
  to authenticated
  using (is_employer_admin(id, auth.uid()))
  with check (is_employer_admin(id, auth.uid()));

-- No delete policy -- mirrors organisations having none.

alter table employer_members enable row level security;

create policy "Employer members can view employer members"
  on employer_members for select
  to authenticated
  using (is_employer_member(employer_id, auth.uid()));

create policy "Employer admins can add employer members"
  on employer_members for insert
  to authenticated
  with check (is_employer_admin(employer_id, auth.uid()));

create policy "Employer admins can update employer members"
  on employer_members for update
  to authenticated
  using (is_employer_admin(employer_id, auth.uid()))
  with check (is_employer_admin(employer_id, auth.uid()));

create policy "Employer admins can remove employer members"
  on employer_members for delete
  to authenticated
  using (is_employer_admin(employer_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- create_employer -- security definer RPC, platform-admin-only (checked
-- internally, same "raise exception" gating convention as other admin-gated
-- RPCs, e.g. 20260831124500_allow_first_catalogue_publication.sql's
-- publish_course_version). Creates the attached provider organisation and
-- the employer row atomically (one function invocation = one transaction),
-- so it's impossible to end up with one created without the other.
-- ----------------------------------------------------------------------------

create or replace function create_employer(p_name text)
returns employers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_organisation_id uuid;
  v_employer employers;
begin
  if v_caller is null or not is_platform_admin(v_caller) then
    raise exception 'Not authorized';
  end if;

  insert into organisations (name, created_by)
  values (p_name, v_caller)
  returning id into v_organisation_id;

  insert into employers (name, provider_organisation_id, created_by)
  values (p_name, v_organisation_id, v_caller)
  returning * into v_employer;

  return v_employer;
end;
$$;

grant execute on function create_employer(text) to authenticated;
