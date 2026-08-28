-- Extends the shared course_catalogue with provider ownership and an
-- approval workflow (platform admins can create/curate directly, or
-- approve/reject/deactivate entries submitted by an organisation's own
-- members), and adds a deactivate-only moderation hook to skill_library and
-- tags (0013/0024 both shipped with no update policy at all, by design at
-- the time -- this is the "editor, planned separately" 0035 referred to).

alter table course_catalogue
  add column organisation_id uuid references organisations(id) on delete set null,
  add column status text not null default 'approved'
    check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'inactive')),
  add column created_by uuid references auth.users(id) on delete set null,
  add column approved_by uuid references auth.users(id) on delete set null,
  add column approved_at timestamptz,
  add column rejection_reason text;

-- Existing seed rows have no organisation and default to 'approved', so
-- they keep showing up in the catalogue exactly as before.

create index course_catalogue_organisation_idx on course_catalogue (organisation_id);
create index course_catalogue_status_idx on course_catalogue (status);

drop policy "Authenticated users can view the course catalogue" on course_catalogue;

create policy "View approved courses, your own organisation's, or as a platform admin"
  on course_catalogue for select
  to authenticated
  using (
    status = 'approved'
    or is_platform_admin(auth.uid())
    or (organisation_id is not null and is_org_member(organisation_id, auth.uid()))
  );

-- Providers insert their own drafts/submissions only, never pre-approved;
-- platform admins can insert directly (any organisation_id, including
-- null for platform-curated entries) at any status.
create policy "Platform admins and organisation members can add catalogue entries"
  on course_catalogue for insert
  to authenticated
  with check (
    is_platform_admin(auth.uid())
    or (
      organisation_id is not null
      and is_org_member(organisation_id, auth.uid())
      and status in ('draft', 'pending_approval')
      and created_by = auth.uid()
    )
  );

create policy "Platform admins can update any catalogue entry"
  on course_catalogue for update
  to authenticated
  using (is_platform_admin(auth.uid()))
  with check (is_platform_admin(auth.uid()));

-- An organisation's own members can only touch their own not-yet-approved
-- (or bounced-back) entries, and can never set status to 'approved'
-- themselves -- enforced by the with check below, not just the app layer.
create policy "Organisation members can edit their own draft or rejected entries"
  on course_catalogue for update
  to authenticated
  using (
    organisation_id is not null
    and is_org_member(organisation_id, auth.uid())
    and status in ('draft', 'rejected')
  )
  with check (
    organisation_id is not null
    and is_org_member(organisation_id, auth.uid())
    and status in ('draft', 'pending_approval', 'rejected')
  );

-- skill_library: deactivate-only moderation hook -- entries stay (matches
-- the "de-activate" language, not delete), platform admins only. 0013
-- shipped with insert-only, no update policy at all.
alter table skill_library add column status text not null default 'active' check (status in ('active', 'inactive'));

create policy "Platform admins can update skill library entries"
  on skill_library for update
  to authenticated
  using (is_platform_admin(auth.uid()))
  with check (is_platform_admin(auth.uid()));

-- tags: same shape -- blacklist rather than delete. 0024 also shipped with
-- insert-only, no update policy at all.
alter table tags add column is_blacklisted boolean not null default false;

create policy "Platform admins can update tags"
  on tags for update
  to authenticated
  using (is_platform_admin(auth.uid()))
  with check (is_platform_admin(auth.uid()));
