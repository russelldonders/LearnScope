-- Additive identity/workspace foundation for multi-context accounts.
--
-- This migration deliberately leaves every existing learner-owned table and
-- query on auth.users/user_id. It creates an application-level person and
-- workspace mapping alongside that model, backfills one personal context per
-- current user, and keeps future ordinary signups in sync through a trigger on
-- profiles. Work SSO classification, account linking, organisation work
-- profiles and domain ownership migration are later, separately reviewable
-- changes.

create schema if not exists private;
revoke all on schema private from public;

create table people (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active' check (status in ('active', 'restricted', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table person_auth_accounts (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  account_type text not null default 'personal'
    check (account_type in ('personal', 'work_sso', 'work_managed')),
  employer_id uuid references employers(id) on delete set null,
  sso_provider_id uuid,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'disconnected')),
  verified_at timestamptz not null default now(),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_user_id),
  check (
    (account_type = 'personal' and employer_id is null)
    or (account_type in ('work_sso', 'work_managed') and employer_id is not null)
  )
);

create index person_auth_accounts_person_idx
  on person_auth_accounts (person_id, status);
create index person_auth_accounts_employer_idx
  on person_auth_accounts (employer_id, status)
  where employer_id is not null;

-- A learning profile is an ownership context, not another copy of the
-- existing profiles row. legacy_user_id is the compatibility bridge for the
-- current personal domain. Organisation profiles can exist before login and
-- therefore need neither person_id nor legacy_user_id initially.
create table learning_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_type text not null check (profile_type in ('personal', 'organisation')),
  person_id uuid references people(id) on delete restrict,
  employer_id uuid references employers(id) on delete cascade,
  legacy_user_id uuid references profiles(id) on delete cascade,
  status text not null default 'active'
    check (status in ('invited', 'active', 'suspended', 'ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (profile_type = 'personal' and person_id is not null and employer_id is null and legacy_user_id is not null)
    or (profile_type = 'organisation' and employer_id is not null and legacy_user_id is null)
  )
);

create unique index learning_profiles_personal_person_unique_idx
  on learning_profiles (person_id)
  where profile_type = 'personal';
create unique index learning_profiles_legacy_user_unique_idx
  on learning_profiles (legacy_user_id)
  where legacy_user_id is not null;
create index learning_profiles_employer_idx
  on learning_profiles (employer_id, status)
  where employer_id is not null;

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  workspace_type text not null check (workspace_type in ('personal', 'manager', 'organisation')),
  name text not null,
  personal_profile_id uuid references learning_profiles(id) on delete cascade,
  owner_person_id uuid references people(id) on delete restrict,
  employer_id uuid references employers(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended', 'ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (workspace_type = 'personal' and personal_profile_id is not null and owner_person_id is not null and employer_id is null)
    or (workspace_type = 'manager' and personal_profile_id is null and owner_person_id is not null and employer_id is null)
    or (workspace_type = 'organisation' and personal_profile_id is null and owner_person_id is null and employer_id is not null)
  )
);

create unique index workspaces_personal_profile_unique_idx
  on workspaces (personal_profile_id)
  where personal_profile_id is not null;
create index workspaces_owner_person_idx
  on workspaces (owner_person_id, status)
  where owner_person_id is not null;
create index workspaces_employer_idx
  on workspaces (employer_id, status)
  where employer_id is not null;

create table workspace_access (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  auth_account_id uuid not null references person_auth_accounts(id) on delete cascade,
  access_role text not null
    check (access_role in ('owner', 'employee', 'manager', 'lms_admin', 'provider')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (workspace_id, auth_account_id, access_role),
  check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);

create index workspace_access_account_idx
  on workspace_access (auth_account_id, status);
create index workspace_access_workspace_idx
  on workspace_access (workspace_id, status);

-- Use each legacy auth UUID as the initial UUID in the new one-to-one rows.
-- This makes the backfill deterministic and idempotent while keeping the
-- tables logically separate. A later verified-link operation may associate
-- another auth account with the same person without changing either auth UUID.
insert into people (id)
select id from auth.users
on conflict (id) do nothing;

insert into person_auth_accounts (id, person_id, auth_user_id, account_type)
select id, id, id, 'personal' from auth.users
on conflict (auth_user_id) do nothing;

insert into learning_profiles (id, profile_type, person_id, legacy_user_id)
select p.id, 'personal', p.id, p.id
from profiles p
join people person_row on person_row.id = p.id
on conflict (id) do nothing;

insert into workspaces (id, workspace_type, name, personal_profile_id, owner_person_id)
select lp.id, 'personal', 'My personal profile', lp.id, lp.person_id
from learning_profiles lp
where lp.profile_type = 'personal'
on conflict (id) do nothing;

insert into workspace_access (workspace_id, auth_account_id, access_role)
select w.id, paa.id, 'owner'
from workspaces w
join person_auth_accounts paa on paa.person_id = w.owner_person_id
where w.workspace_type = 'personal'
  and paa.account_type = 'personal'
on conflict (workspace_id, auth_account_id, access_role) do nothing;

-- Keep ordinary future signups in the same one-person/one-personal-workspace
-- compatibility shape. Enterprise SSO provisioning will use a separate flow
-- before it is enabled, so an SSO login is never silently classified here.
create or replace function private.bootstrap_personal_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.people (id) values (new.id)
  on conflict (id) do nothing;

  insert into public.person_auth_accounts (id, person_id, auth_user_id, account_type)
  values (new.id, new.id, new.id, 'personal')
  on conflict (auth_user_id) do nothing;

  insert into public.learning_profiles (id, profile_type, person_id, legacy_user_id)
  values (new.id, 'personal', new.id, new.id)
  on conflict (id) do nothing;

  insert into public.workspaces (id, workspace_type, name, personal_profile_id, owner_person_id)
  values (new.id, 'personal', 'My personal profile', new.id, new.id)
  on conflict (id) do nothing;

  insert into public.workspace_access (workspace_id, auth_account_id, access_role)
  values (new.id, new.id, 'owner')
  on conflict (workspace_id, auth_account_id, access_role) do nothing;

  return new;
end;
$$;

revoke all on function private.bootstrap_personal_context() from public, anon, authenticated;

create trigger bootstrap_personal_context_trigger
  after insert on profiles
  for each row execute procedure private.bootstrap_personal_context();

-- Read-only client surface for this foundation. Mutations arrive through
-- narrowly scoped functions in later phases; no authenticated role receives a
-- blanket INSERT/UPDATE/DELETE grant.
grant select on people, person_auth_accounts, learning_profiles, workspaces, workspace_access to authenticated;

alter table people enable row level security;
alter table person_auth_accounts enable row level security;
alter table learning_profiles enable row level security;
alter table workspaces enable row level security;
alter table workspace_access enable row level security;

create policy "Authentication accounts can view their person"
  on people for select
  to authenticated
  using (
    exists (
      select 1 from person_auth_accounts paa
      where paa.person_id = people.id
        and paa.auth_user_id = (select auth.uid())
        and paa.status = 'active'
    )
  );

create policy "Users can view their current authentication account"
  on person_auth_accounts for select
  to authenticated
  using (auth_user_id = (select auth.uid()));

-- Work authentication accounts deliberately fail this personal-profile
-- policy even after a future account link maps them to the same person.
create policy "Personal accounts can view their personal learning profile"
  on learning_profiles for select
  to authenticated
  using (
    profile_type = 'personal'
    and exists (
      select 1 from person_auth_accounts paa
      where paa.person_id = learning_profiles.person_id
        and paa.auth_user_id = (select auth.uid())
        and paa.account_type = 'personal'
        and paa.status = 'active'
    )
  );

create policy "Authentication accounts can view their workspace access"
  on workspace_access for select
  to authenticated
  using (
    exists (
      select 1 from person_auth_accounts paa
      where paa.id = workspace_access.auth_account_id
        and paa.auth_user_id = (select auth.uid())
        and paa.status = 'active'
    )
  );

create policy "Authentication accounts can view accessible workspaces"
  on workspaces for select
  to authenticated
  using (
    exists (
      select 1
      from workspace_access wa
      join person_auth_accounts paa on paa.id = wa.auth_account_id
      where wa.workspace_id = workspaces.id
        and wa.status = 'active'
        and paa.auth_user_id = (select auth.uid())
        and paa.status = 'active'
    )
  );

