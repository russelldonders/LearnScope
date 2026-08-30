-- Lets an organisation admin designate specific members of their own
-- provider organisation as "catalogue approvers" -- able to approve/reject/
-- deactivate their own org's course_catalogue submissions without needing
-- a platform admin. Platform admins keep their existing, unscoped
-- moderation power (0066's "Platform admins can update any catalogue
-- entry") over every organisation's entries and the platform-curated
-- (organisation_id is null) catalogue -- this migration only adds a
-- narrower, org-scoped alternative path, it doesn't touch that policy.

create table catalogue_approvers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organisation_id, user_id)
);

create index catalogue_approvers_organisation_idx on catalogue_approvers (organisation_id);
create index catalogue_approvers_user_idx on catalogue_approvers (user_id);

-- security definer, same shape/reason as is_org_admin/is_org_member (0065),
-- including the organisations.status = 'active' check 0069 added to those
-- two -- without it, a platform admin deactivating a provider org (meant to
-- have "real consequence" for that org's own access, per 0069) would leave
-- a previously-designated approver still able to move that org's
-- course_catalogue rows.
create or replace function is_catalogue_approver(org_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from catalogue_approvers
    join organisations on organisations.id = catalogue_approvers.organisation_id
    where catalogue_approvers.organisation_id = org_id
      and catalogue_approvers.user_id = check_user_id
      and organisations.status = 'active'
  )
$$;

grant execute on function is_catalogue_approver(uuid, uuid) to authenticated;

alter table catalogue_approvers enable row level security;

create policy "Org members can view their organisation's catalogue approvers"
  on catalogue_approvers for select
  to authenticated
  using (is_org_member(organisation_id, auth.uid()));

-- The designated user must already be an active member of the same
-- organisation (not a still-pending invite, matching is_org_member's own
-- 0070 status check) -- this is a list of that org's own users, not an
-- arbitrary allowlist.
create policy "Org admins can designate catalogue approvers from their own users"
  on catalogue_approvers for insert
  to authenticated
  with check (
    is_org_admin(organisation_id, auth.uid())
    and exists (
      select 1 from organisation_members om
      where om.organisation_id = catalogue_approvers.organisation_id
        and om.user_id = catalogue_approvers.user_id
        and om.status = 'active'
    )
  );

create policy "Org admins can remove catalogue approvers"
  on catalogue_approvers for delete
  to authenticated
  using (is_org_admin(organisation_id, auth.uid()));

-- catalogue_approvers has no FK to organisation_members (it points straight
-- at organisations/auth.users, since an approver grant should outlive a
-- role change), so removing someone's staff access (removeOrganisationMember
-- -- a hard delete, not a status flip) wouldn't otherwise also revoke an
-- existing approver grant, leaving a former member able to keep approving
-- that org's submissions via is_catalogue_approver.
create or replace function revoke_catalogue_approver_on_membership_removal()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from catalogue_approvers
  where organisation_id = old.organisation_id and user_id = old.user_id;
  return old;
end;
$$;

create trigger revoke_catalogue_approver_on_membership_removal_trigger
  after delete on organisation_members
  for each row execute procedure revoke_catalogue_approver_on_membership_removal();

-- Unlike "Platform admins can update any catalogue entry" (0066, deliberately
-- unrestricted), these are split into the specific status transitions
-- src/pages/admin/AdminCatalogue.jsx's own moderation actions actually use
-- (approve, reject, deactivate, reactivate) -- same narrow-policy-per-
-- transition shape as 0066/0088's org-member policies. Restricting `with
-- check`'s target status this way also means a plain content-only edit
-- (name/synopsis/etc, status left unchanged) can never satisfy any of these
-- three, so an approver can't use this update path to silently rewrite an
-- already-approved, live course's content -- they'd have to genuinely
-- deactivate/reactivate it, same as the admin console requires.
create policy "Catalogue approvers can approve or reject their organisation's submissions"
  on course_catalogue for update
  to authenticated
  using (
    organisation_id is not null
    and is_catalogue_approver(organisation_id, auth.uid())
    and status in ('draft', 'pending_approval')
  )
  with check (
    organisation_id is not null
    and is_catalogue_approver(organisation_id, auth.uid())
    and status in ('approved', 'rejected')
  );

create policy "Catalogue approvers can deactivate their organisation's approved courses"
  on course_catalogue for update
  to authenticated
  using (
    organisation_id is not null
    and is_catalogue_approver(organisation_id, auth.uid())
    and status = 'approved'
  )
  with check (
    organisation_id is not null
    and is_catalogue_approver(organisation_id, auth.uid())
    and status = 'inactive'
  );

create policy "Catalogue approvers can reactivate their organisation's inactive or rejected courses"
  on course_catalogue for update
  to authenticated
  using (
    organisation_id is not null
    and is_catalogue_approver(organisation_id, auth.uid())
    and status in ('inactive', 'rejected')
  )
  with check (
    organisation_id is not null
    and is_catalogue_approver(organisation_id, auth.uid())
    and status = 'approved'
  );
