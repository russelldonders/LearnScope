-- Foundational role/permission system: a flat platform_admins allowlist
-- (full platform-owner console access -- a table rather than a single flag
-- so more than one account can hold it), plus organisations/
-- organisation_members for provider-type orgs. In this pass, organisations
-- are created and staffed only by platform admins; organisation_members
-- also lets an org's own admin manage their own trainers/staff, per the
-- "should be able to create profiles for all their trainers and admin
-- staff" requirement. No provider-facing UI yet -- this schema is what
-- that follow-up pass will build on.

create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now()
);

-- type stays free text (default 'provider') rather than a check constraint
-- so future org types (training providers already covered, but also
-- employers/coaches per CLAUDE.md's future-direction section) don't need a
-- migration just to be assignable -- no UI for anything but 'provider' yet.
create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'provider',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organisation_members (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'trainer')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organisation_id, user_id)
);

create index organisation_members_org_idx on organisation_members (organisation_id);
create index organisation_members_user_idx on organisation_members (user_id);

-- ----------------------------------------------------------------------------
-- Helper functions -- security definer, mirroring the resolution 0052/0059
-- established for self-referencing RLS: platform_admins' own SELECT policy
-- needs is_platform_admin(), which queries platform_admins itself, so the
-- check has to bypass RLS internally rather than re-entering it mid-
-- evaluation. Same shape applies to organisation_members via
-- is_org_admin/is_org_member below.
-- ----------------------------------------------------------------------------

create or replace function is_platform_admin(check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from platform_admins where user_id = check_user_id
  )
$$;

grant execute on function is_platform_admin(uuid) to authenticated;

create or replace function is_org_admin(org_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organisation_members
    where organisation_id = org_id and user_id = check_user_id and role = 'admin'
  ) or is_platform_admin(check_user_id)
$$;

grant execute on function is_org_admin(uuid, uuid) to authenticated;

create or replace function is_org_member(org_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organisation_members
    where organisation_id = org_id and user_id = check_user_id
  ) or is_platform_admin(check_user_id)
$$;

grant execute on function is_org_member(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table platform_admins enable row level security;

create policy "Platform admins can view the admin list"
  on platform_admins for select
  to authenticated
  using (is_platform_admin(auth.uid()));

create policy "Platform admins can grant platform admin access"
  on platform_admins for insert
  to authenticated
  with check (is_platform_admin(auth.uid()));

create policy "Platform admins can revoke platform admin access"
  on platform_admins for delete
  to authenticated
  using (is_platform_admin(auth.uid()));

alter table organisations enable row level security;

-- Open select: providers should be visible/browsable (e.g. a course
-- catalogue entry showing who offers it), not just to platform admins.
create policy "Authenticated users can view organisations"
  on organisations for select
  to authenticated
  using (true);

create policy "Platform admins can create organisations"
  on organisations for insert
  to authenticated
  with check (is_platform_admin(auth.uid()));

create policy "Platform admins can update organisations"
  on organisations for update
  to authenticated
  using (is_platform_admin(auth.uid()))
  with check (is_platform_admin(auth.uid()));

alter table organisation_members enable row level security;

create policy "Platform admins and org members can view organisation members"
  on organisation_members for select
  to authenticated
  using (is_org_member(organisation_id, auth.uid()));

create policy "Platform admins and org admins can add organisation members"
  on organisation_members for insert
  to authenticated
  with check (is_org_admin(organisation_id, auth.uid()));

create policy "Platform admins and org admins can remove organisation members"
  on organisation_members for delete
  to authenticated
  using (is_org_admin(organisation_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- profiles.account_status -- display-only mirror of the auth-level ban set
-- by api/admin/set-user-blocked.js (auth.admin.updateUserById ban_duration).
-- Lets the admin console show status without an extra auth-admin API round
-- trip. profiles' existing "Users manage their own profile" policy (0002)
-- is for-all/auth.uid()=id, which would otherwise let a learner unblock
-- themselves just by editing their own profile row -- guard the column with
-- a trigger rather than restructuring that broad policy.
-- ----------------------------------------------------------------------------

alter table profiles add column account_status text not null default 'active' check (account_status in ('active', 'blocked'));

create or replace function prevent_self_account_status_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.account_status is distinct from old.account_status
     and auth.uid() is not null
     and not is_platform_admin(auth.uid()) then
    raise exception 'account_status can only be changed by a platform admin';
  end if;
  return new;
end;
$$;

create trigger prevent_self_account_status_change_trigger
  before update on profiles
  for each row execute procedure prevent_self_account_status_change();
