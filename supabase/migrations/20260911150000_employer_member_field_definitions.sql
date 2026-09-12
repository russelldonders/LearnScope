-- Employer-configurable fields for an employer's managed-learner roster.
--
-- Deliberately separate from `profiles` -- an employer admin entering a
-- member's name/email/location/language here is NOT writing to the
-- learner's own profile (which stays exclusively learner-owned, per
-- CLAUDE.md's learner-ownership principle and Profile.jsx's owner-only
-- RLS). This is the employer's own HR-style record about the person --
-- useful even before they've signed up -- kept as a genuinely separate
-- table so it never overrides anything the learner controls themselves.
--
-- One field-definition table serves both tiers the product needs:
--   - employer_id is null: a "base" field, owned and fully managed
--     (create/rename/reorder/remove) by platform admins, visible to every
--     employer.
--   - employer_id is set: that employer's own additional field, managed
--     only by that employer's admins, visible only to them.
-- Values live in a separate table keyed to employer_members + the field
-- definition, same owned-vs-shared split organisation_members/employers
-- already established for other employer-domain concepts.

create table employer_field_definitions (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid references employers(id) on delete cascade,
  key text not null,
  label text not null,
  field_type text not null check (field_type in ('text', 'textarea', 'number', 'date', 'select', 'boolean', 'email')),
  options jsonb,
  required boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Key must be unique within its own scope: once among the global/base
-- fields, once within each employer's own additional fields -- but the
-- same key may exist in both scopes (an employer could theoretically shadow
-- a base field's key, though the app UI won't offer to).
create unique index employer_field_definitions_global_key_unique_idx
  on employer_field_definitions (key) where employer_id is null;
create unique index employer_field_definitions_employer_key_unique_idx
  on employer_field_definitions (employer_id, key) where employer_id is not null;

create index employer_field_definitions_employer_idx on employer_field_definitions (employer_id);

create table employer_member_field_values (
  id uuid primary key default gen_random_uuid(),
  employer_member_id uuid not null references employer_members(id) on delete cascade,
  field_definition_id uuid not null references employer_field_definitions(id) on delete cascade,
  value text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (employer_member_id, field_definition_id)
);

create index employer_member_field_values_member_idx on employer_member_field_values (employer_member_id);
create index employer_member_field_values_field_idx on employer_member_field_values (field_definition_id);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table employer_field_definitions enable row level security;

-- Any employer admin needs to see the base fields to render their roster
-- form, even though no single employer_id "owns" a base row -- hence the
-- separate any-employer-admin check for employer_id is null, rather than
-- reusing is_employer_admin(employer_id, ...) which requires a real row to
-- match against.
create policy "Admins can view field definitions"
  on employer_field_definitions for select
  to authenticated
  using (
    is_platform_admin(auth.uid())
    or (employer_id is not null and is_employer_admin(employer_id, auth.uid()))
    or (employer_id is null and exists (
      select 1 from employer_members em
      where em.user_id = auth.uid() and em.role = 'admin' and em.status = 'active'
    ))
  );

create policy "Platform admins can add base field definitions"
  on employer_field_definitions for insert
  to authenticated
  with check (employer_id is null and is_platform_admin(auth.uid()));

create policy "Platform admins can update base field definitions"
  on employer_field_definitions for update
  to authenticated
  using (employer_id is null and is_platform_admin(auth.uid()))
  with check (employer_id is null and is_platform_admin(auth.uid()));

create policy "Platform admins can delete base field definitions"
  on employer_field_definitions for delete
  to authenticated
  using (employer_id is null and is_platform_admin(auth.uid()));

create policy "Employer admins can add their own field definitions"
  on employer_field_definitions for insert
  to authenticated
  with check (employer_id is not null and is_employer_admin(employer_id, auth.uid()));

create policy "Employer admins can update their own field definitions"
  on employer_field_definitions for update
  to authenticated
  using (employer_id is not null and is_employer_admin(employer_id, auth.uid()))
  with check (employer_id is not null and is_employer_admin(employer_id, auth.uid()));

create policy "Employer admins can delete their own field definitions"
  on employer_field_definitions for delete
  to authenticated
  using (employer_id is not null and is_employer_admin(employer_id, auth.uid()));

alter table employer_member_field_values enable row level security;

-- Deliberately no learner-select policy -- this is the employer's own
-- roster record about the person, not part of the learner's own profile,
-- so the member being described has no special access to it here (same
-- reasoning that kept this out of `profiles` entirely).
create policy "Employer admins can view their members' field values"
  on employer_member_field_values for select
  to authenticated
  using (
    exists (
      select 1 from employer_members em
      where em.id = employer_member_id and is_employer_admin(em.employer_id, auth.uid())
    )
  );

-- The join to employer_field_definitions in the with-check clauses stops an
-- employer admin from attaching a value to a field definition owned by a
-- *different* employer -- only global fields or that employer's own fields
-- are valid targets.
create policy "Employer admins can set their members' field values"
  on employer_member_field_values for insert
  to authenticated
  with check (
    exists (
      select 1 from employer_members em
      join employer_field_definitions fd
        on fd.id = field_definition_id and (fd.employer_id is null or fd.employer_id = em.employer_id)
      where em.id = employer_member_id and is_employer_admin(em.employer_id, auth.uid())
    )
  );

create policy "Employer admins can update their members' field values"
  on employer_member_field_values for update
  to authenticated
  using (
    exists (
      select 1 from employer_members em
      where em.id = employer_member_id and is_employer_admin(em.employer_id, auth.uid())
    )
  )
  with check (
    exists (
      select 1 from employer_members em
      join employer_field_definitions fd
        on fd.id = field_definition_id and (fd.employer_id is null or fd.employer_id = em.employer_id)
      where em.id = employer_member_id and is_employer_admin(em.employer_id, auth.uid())
    )
  );

create policy "Employer admins can remove their members' field values"
  on employer_member_field_values for delete
  to authenticated
  using (
    exists (
      select 1 from employer_members em
      where em.id = employer_member_id and is_employer_admin(em.employer_id, auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- Seed the ten requested base fields as global definitions -- platform
-- admins can rename, reorder, remove, or add to these afterward via the
-- same admin UI/table; this is a starting point, not a fixed list.
-- ----------------------------------------------------------------------------

insert into employer_field_definitions (employer_id, key, label, field_type, options, required, sort_order) values
  (null, 'first_name', 'First name', 'text', null, true, 10),
  (null, 'last_name', 'Last name', 'text', null, true, 20),
  (null, 'email', 'Email', 'email', null, true, 30),
  (null, 'employment_status', 'Status', 'select', '["Active", "On leave", "Inactive"]'::jsonb, false, 40),
  (null, 'location', 'Location', 'text', null, false, 50),
  (null, 'language', 'Language', 'text', null, false, 60),
  (null, 'department', 'Department', 'text', null, false, 70),
  (null, 'job_title', 'Job title', 'text', null, false, 80),
  (null, 'start_date', 'Start date', 'date', null, false, 90),
  (null, 'end_date', 'End date', 'date', null, false, 100);
