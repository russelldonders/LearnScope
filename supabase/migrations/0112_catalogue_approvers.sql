-- Redesigned against 0111's real per-catalogue model (a provider can own
-- several named catalogues, plus the platform-managed Global catalogue) --
-- an org admin designates specific active members of their own org as
-- approvers of one of their org's own (non-global) catalogues, able to
-- approve/reject/deactivate a course being published into that catalogue,
-- without needing a platform admin. Nobody can be an approver of the
-- Global catalogue (it has no organisation_id, so the insert policy below
-- can never match it) -- publishing anything into it stays platform-admin
-- only, same as today.

create table catalogue_approvers (
  id uuid primary key default gen_random_uuid(),
  catalogue_id uuid not null references catalogues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (catalogue_id, user_id)
);

create index catalogue_approvers_catalogue_idx on catalogue_approvers (catalogue_id);
create index catalogue_approvers_user_idx on catalogue_approvers (user_id);

-- security definer, same shape/reason as is_org_admin/is_org_member (0065),
-- including the organisations.status = 'active' check 0069 added to those
-- two -- without it, a platform admin deactivating a provider org would
-- leave a previously-designated approver still able to move that org's
-- course_catalogue rows.
create or replace function is_catalogue_approver(p_catalogue_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from catalogue_approvers ca
    join catalogues c on c.id = ca.catalogue_id
    join organisations o on o.id = c.organisation_id
    where ca.catalogue_id = p_catalogue_id
      and ca.user_id = p_user_id
      and o.status = 'active'
  )
$$;

grant execute on function is_catalogue_approver(uuid, uuid) to authenticated;

alter table catalogue_approvers enable row level security;

create policy "Org members can view their organisation's catalogue approvers"
  on catalogue_approvers for select
  to authenticated
  using (
    exists (
      select 1 from catalogues c
      where c.id = catalogue_approvers.catalogue_id
        and c.organisation_id is not null
        and is_org_member(c.organisation_id, auth.uid())
    )
  );

-- The target catalogue must belong to the calling admin's own organisation
-- (never the Global catalogue, since it has no organisation_id), and the
-- designated user must already be an active member of that same
-- organisation (not a still-pending invite, matching is_org_member's own
-- 0070 status check) -- this is a list of that org's own users against
-- that org's own catalogue, not an arbitrary allowlist. added_by is pinned
-- to the caller so a crafted request can't misattribute (or null out) who
-- granted the approval right.
create policy "Org admins can designate catalogue approvers from their own users"
  on catalogue_approvers for insert
  to authenticated
  with check (
    added_by = auth.uid()
    and exists (
      select 1 from catalogues c
      where c.id = catalogue_approvers.catalogue_id
        and c.organisation_id is not null
        and is_org_admin(c.organisation_id, auth.uid())
        and exists (
          select 1 from organisation_members om
          where om.organisation_id = c.organisation_id
            and om.user_id = catalogue_approvers.user_id
            and om.status = 'active'
        )
    )
  );

create policy "Org admins can remove catalogue approvers"
  on catalogue_approvers for delete
  to authenticated
  using (
    exists (
      select 1 from catalogues c
      where c.id = catalogue_approvers.catalogue_id
        and c.organisation_id is not null
        and is_org_admin(c.organisation_id, auth.uid())
    )
  );

-- catalogue_approvers has no FK to organisation_members (it points at
-- catalogues/auth.users, since an approver grant should outlive a role
-- change), so removing someone's staff access (removeOrganisationMember --
-- a hard delete, not a status flip) wouldn't otherwise also revoke an
-- existing approver grant on that org's catalogues.
create or replace function revoke_catalogue_approver_on_membership_removal()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from catalogue_approvers
  using catalogues
  where catalogue_approvers.catalogue_id = catalogues.id
    and catalogues.organisation_id = old.organisation_id
    and catalogue_approvers.user_id = old.user_id;
  return old;
end;
$$;

create trigger revoke_catalogue_approver_on_membership_removal_trigger
  after delete on organisation_members
  for each row execute procedure revoke_catalogue_approver_on_membership_removal();

-- Reject/deactivate/approve are all authorized through security-definer
-- RPCs rather than plain-table-update RLS grants. A general-purpose RLS
-- UPDATE policy for a catalogue approver (who may be an ordinary staff
-- member, not an org admin) can only constrain the columns it names in its
-- with-check -- it can't stop the same statement from also rewriting
-- name/synopsis/image_url/etc on a pending_approval or already-approved
-- row, since 0066's own org-member edit policy only ever applies while
-- status is draft/rejected. Routing every transition through a function
-- that performs its own narrow `set status = ..., <specific columns>`
-- closes that off entirely, and lets each one check authorization against
-- the *specific* catalogue(s) the course was actually submitted to
-- (course_catalogue_publications), not just "approver of some catalogue in
-- this org" -- matching what an org that splits approval authority across
-- multiple catalogues actually expects.
--
-- All three also front-load the authorization check ahead of any
-- course-specific detail: a non-admin caller always gets a flat 'Not
-- authorized' whether the course doesn't exist, has no publications yet, or
-- they're simply not an approver for all of its selected catalogues, so
-- probing an arbitrary course id can't be used to learn anything about it.
-- Platform admins (who can already see everything) get the more specific
-- diagnostic instead.

create or replace function publish_course_version(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_caller uuid := (select auth.uid());
  v_is_admin boolean := is_platform_admin(v_caller);
  v_has_publications boolean;
  v_approved_for_all boolean;
begin
  select version_group_id into v_group_id
  from course_catalogue
  where id = p_course_id
  for update;

  v_has_publications := v_group_id is not null and exists (
    select 1 from course_catalogue_publications where course_id = p_course_id
  );

  v_approved_for_all := v_group_id is not null and not exists (
    select 1
    from course_catalogue_publications ccp
    where ccp.course_id = p_course_id
      and not is_catalogue_approver(ccp.catalogue_id, v_caller)
  );

  if not v_is_admin and (v_group_id is null or not v_has_publications or not v_approved_for_all) then
    raise exception 'Not authorized';
  end if;

  if v_is_admin and v_group_id is null then
    raise exception 'Course not found';
  end if;

  if not v_has_publications then
    raise exception 'Choose at least one publication catalogue';
  end if;

  update course_catalogue
  set status = 'inactive', is_current_published = false
  where version_group_id = v_group_id
    and is_current_published
    and id <> p_course_id;

  update course_catalogue
  set status = 'approved',
      is_current_published = true,
      approved_by = v_caller,
      approved_at = now(),
      rejection_reason = null
  where id = p_course_id;

  update course_catalogue_publications
  set published_at = now()
  where course_id = p_course_id;
end;
$$;

revoke all on function publish_course_version(uuid) from public;
grant execute on function publish_course_version(uuid) to authenticated;

create or replace function reject_course_submission(p_course_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_is_admin boolean := is_platform_admin(v_caller);
  v_status text;
  v_found boolean;
  v_has_publications boolean;
  v_approved_for_all boolean;
begin
  select status into v_status
  from course_catalogue
  where id = p_course_id
  for update;

  v_found := found;

  v_has_publications := v_found and exists (
    select 1 from course_catalogue_publications where course_id = p_course_id
  );

  v_approved_for_all := v_found and not exists (
    select 1
    from course_catalogue_publications ccp
    where ccp.course_id = p_course_id
      and not is_catalogue_approver(ccp.catalogue_id, v_caller)
  );

  if not v_is_admin and (not v_found or not v_has_publications or not v_approved_for_all) then
    raise exception 'Not authorized';
  end if;

  if not v_found then
    raise exception 'Course not found';
  end if;

  if v_status <> 'pending_approval' then
    raise exception 'Only a pending submission can be rejected';
  end if;

  update course_catalogue
  set status = 'rejected',
      rejection_reason = p_reason,
      approved_by = null,
      approved_at = null,
      is_current_published = false
  where id = p_course_id;
end;
$$;

revoke all on function reject_course_submission(uuid, text) from public;
grant execute on function reject_course_submission(uuid, text) to authenticated;

create or replace function deactivate_course_publication(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_is_admin boolean := is_platform_admin(v_caller);
  v_status text;
  v_found boolean;
  v_has_publications boolean;
  v_approved_for_all boolean;
begin
  select status into v_status
  from course_catalogue
  where id = p_course_id
  for update;

  v_found := found;

  v_has_publications := v_found and exists (
    select 1 from course_catalogue_publications where course_id = p_course_id
  );

  v_approved_for_all := v_found and not exists (
    select 1
    from course_catalogue_publications ccp
    where ccp.course_id = p_course_id
      and not is_catalogue_approver(ccp.catalogue_id, v_caller)
  );

  if not v_is_admin and (not v_found or not v_has_publications or not v_approved_for_all) then
    raise exception 'Not authorized';
  end if;

  if not v_found then
    raise exception 'Course not found';
  end if;

  if v_status <> 'approved' then
    raise exception 'Only an approved course can be deactivated';
  end if;

  update course_catalogue
  set status = 'inactive', is_current_published = false
  where id = p_course_id;
end;
$$;

revoke all on function deactivate_course_publication(uuid) from public;
grant execute on function deactivate_course_publication(uuid) to authenticated;
