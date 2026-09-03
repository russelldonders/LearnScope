-- ----------------------------------------------------------------------------
-- Console overhaul Phase 5 ("Guidance and activity history"): a curated
-- platform-admin activity log. Proposed, reviewed and approved (event
-- boundaries, platform-admin-only visibility for v1, and a 7-year
-- retention policy -- see PR/session history for the full written
-- proposal covering event boundaries, RLS reasoning, personal-data and
-- retention discussion, migration/rollback plan).
--
-- Purely additive: one new table (admin_activity_log), plus a curated set
-- of existing security-definer functions and admin-API handlers each gain
-- one extra `insert` after an already-successful transition or delete
-- (user.deleted in api/admin/actions.js logs only after auth.admin.
-- deleteUser succeeds, precisely so a delete that fails leaves no false
-- entry in a 7-year-retention log; the *_removed trigger functions below
-- fire AFTER DELETE within the same transaction as the row's own removal).
-- No existing table, column, row, or RLS policy is touched. Fully
-- reversible by
-- dropping the functions this migration redefines and re-applying their
-- prior bodies (0112 for the course-catalogue ones; 0112/0065/0066/0111
-- etc. for the others, per git history), then `drop table
-- admin_activity_log;`.
--
-- Full curated action list wired here or in api/admin/actions.js:
--   course.approved / course.rejected / course.deactivated
--   user.blocked / user.unblocked / user.deleted
--   skill.activated / skill.deactivated
--   tag.blacklisted / tag.unblacklisted
--   organisation.activated / organisation.suspended
--   catalogue_approver.added / catalogue_approver.removed
--   employer_member.added / employer_member.removed
--   org_member.removed
-- ----------------------------------------------------------------------------

create table admin_activity_log (
  id uuid primary key default gen_random_uuid(),
  -- SET NULL, not CASCADE: a log entry records that something happened and
  -- who did it -- it must outlive the actor's own account being deleted
  -- later, same reasoning tags.created_by/skill_library.created_by already
  -- use for shared-catalog attribution (0064).
  actor_id uuid references auth.users(id) on delete set null,
  -- Denormalized "who" snapshot captured at write time. Without this,
  -- actor_id going null after an account deletion (or a later name change)
  -- would make an old entry anonymous with no record of who it originally
  -- was -- the same snapshot-before-scrub reasoning as skill_peer_ratings.
  -- rater_name/rater_email (0064's delete_own_account_scrub).
  actor_label text not null,
  -- Dot-namespaced action identifier, e.g. 'course.approved',
  -- 'user.blocked'. Deliberately NOT a check-constrained enum: the curated
  -- set is documented and enforced at the call site (the RPC or admin API
  -- action that performs the underlying change), not the schema, so adding
  -- a new logged action is a normal application change rather than a
  -- migration. See the proposal for the full recommended action list.
  action text not null check (length(trim(action)) > 0),
  -- What kind of record the action targeted, e.g. 'course_catalogue',
  -- 'profile'. No FK on purpose -- this is intentionally polymorphic
  -- (points at a different table depending on entity_type). See the
  -- proposal's RLS section for why a general provider-visible policy over
  -- this polymorphic shape is deferred rather than built now.
  entity_type text not null check (length(trim(entity_type)) > 0),
  entity_id uuid not null,
  -- Denormalized "what" snapshot (e.g. the course name at the moment it was
  -- approved) -- survives the entity later being renamed, reassigned, or
  -- deleted, same reasoning as actor_label above.
  entity_label text,
  -- Free-text detail an admin/approver supplied for the action, e.g. a
  -- rejection reason. Null when the action carries none.
  reason text,
  -- Small structured extras that don't warrant their own column (e.g. a
  -- previous/new value pair). Never intended to hold anything not already
  -- safe to show a platform admin -- see the proposal's personal-data
  -- section.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_activity_log_created_at_idx on admin_activity_log (created_at desc);
create index admin_activity_log_entity_idx on admin_activity_log (entity_type, entity_id);
create index admin_activity_log_actor_idx on admin_activity_log (actor_id);

comment on table admin_activity_log is
  'Curated log of high-impact platform-admin/provider-moderation actions -- not a general audit trail of every mutation. Written only by security-definer RPCs and the service-role admin API, never directly by client code. Retention: 7 years from created_at (approved product/compliance policy) -- no automated purge job exists yet; enforcing that window is follow-up work once a scheduled-job mechanism exists in this codebase. See migration 20260903090000 for full rationale.';

alter table admin_activity_log enable row level security;

-- Platform-admin-only for this first version. A fully general
-- provider-visible policy (e.g. "a provider admin can see log entries
-- about their own organisation's courses/staff") can't cleanly express
-- "does this entity belong to an org the caller administers" once
-- entity_type/entity_id are polymorphic -- course_catalogue rows resolve
-- an org via organisation_id, profile rows have no org at all, an
-- employer_members row resolves via employers.provider_organisation_id,
-- and so on. Doing that generically inside one RLS policy means either a
-- large per-entity-type CASE/UNION (fragile -- silently wrong for any
-- entity_type the policy autor forgot) or a per-row denormalized org_id
-- column that has to be kept in sync by every writer. Recommendation:
-- ship platform-admin-only now, and revisit a scoped provider-visible
-- policy (most likely a small, explicit per-entity-type mapping, or a
-- denormalized organisation_id column populated only for the entity types
-- that need it) once a specific provider-facing use case justifies the
-- added complexity, rather than generalizing speculatively today.
create policy "Platform admins can view the activity log"
  on admin_activity_log for select
  to authenticated
  using (is_platform_admin(auth.uid()));

-- No insert/update/delete policy for `authenticated` at all -- same
-- convention as employer_data_access_requests (20260902200000) and the
-- catalogue moderation RPCs (0112): every write goes through a
-- security-definer function (whose owner bypasses RLS) or the
-- service-role admin API (which bypasses RLS by design), never a plain
-- client-side insert. Explicit select-only grant below documents that
-- boundary; Supabase's schema-level defaults would otherwise imply
-- broader table privileges than RLS actually allows.
grant select on admin_activity_log to authenticated;

-- Shared denormalized-actor-label lookup, used by every writer below
-- (RPCs and triggers alike) instead of repeating the same join. Security
-- definer for the same reason as is_platform_admin/is_catalogue_approver:
-- callers other than a platform admin have no read access to auth.users
-- or to other people's profiles rows.
create or replace function admin_activity_actor_label(p_user_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(p.full_name, u.email, p_user_id::text)
  from auth.users u
  left join profiles p on p.id = u.id
  where u.id = p_user_id
$$;

-- No grant to authenticated either -- this is purely an internal helper for
-- the security-definer writers below (their own definer privileges are what
-- let them call it, not a grant), never meant to be called directly by any
-- end user. Confirmed live: a signed-in non-admin could otherwise call this
-- RPC themselves and resolve an arbitrary UUID to a name/email -- a narrower
-- version of the same anon-oracle bug this revoke already closes below.
revoke all on function admin_activity_actor_label(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Instrumentation: course approve/reject/deactivate. Reproduces
-- publish_course_version/reject_course_submission's bodies from 0112 and
-- deactivate_course_publication's body from 20260901100000 unchanged,
-- plus one insert each at the end of an already-successful transition
-- (after every authorization/state check, so a rejected attempt never
-- reaches the log).
-- ----------------------------------------------------------------------------

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
  v_course_name text;
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
  where id = p_course_id
  returning name into v_course_name;

  update course_catalogue_publications
  set published_at = now()
  where course_id = p_course_id;

  insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label)
  values (v_caller, admin_activity_actor_label(v_caller), 'course.approved', 'course_catalogue', p_course_id, v_course_name);
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
  v_course_name text;
begin
  select status, name into v_status, v_course_name
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

  insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label, reason)
  values (v_caller, admin_activity_actor_label(v_caller), 'course.rejected', 'course_catalogue', p_course_id, v_course_name, p_reason);
end;
$$;

revoke all on function reject_course_submission(uuid, text) from public;
grant execute on function reject_course_submission(uuid, text) to authenticated;

-- deactivate_course_publication: reproduces 20260901100000's body (the
-- latest -- supersedes 0112's, adding the catalogue-less/org-member path)
-- unchanged, plus one insert at the end.
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
  v_organisation_id uuid;
  v_found boolean;
  v_has_publications boolean;
  v_approved_for_all boolean;
  v_is_org_member boolean;
  v_course_name text;
begin
  select status, organisation_id, name into v_status, v_organisation_id, v_course_name
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

  v_is_org_member := v_found and v_organisation_id is not null and is_org_member(v_organisation_id, v_caller);

  if not v_is_admin
    and not (v_has_publications and v_approved_for_all)
    and not (not v_has_publications and v_is_org_member)
  then
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

  insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label)
  values (v_caller, admin_activity_actor_label(v_caller), 'course.deactivated', 'course_catalogue', p_course_id, v_course_name);
end;
$$;

revoke all on function deactivate_course_publication(uuid) from public;
grant execute on function deactivate_course_publication(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Instrumentation: the remaining curated actions. Each of these is a plain
-- RLS-gated client-side table write (update or delete), not a
-- security-definer RPC, so there's no existing function body to extend --
-- an AFTER trigger is the mechanical equivalent: it fires on every write
-- to the table regardless of call site, the same "can't be silently
-- skipped" property the manual inserts above get from being the very
-- last statement in an already-authorized function. This is the same
-- security-definer-trigger shape 0112's own
-- revoke_catalogue_approver_on_membership_removal_trigger already uses to
-- write a side effect RLS wouldn't otherwise allow the row's own
-- policies to produce.
--
-- Guard: every trigger below skips logging when auth.uid() is null. This
-- matters because several of these tables cascade-delete from auth.users
-- (organisation_members.user_id, catalogue_approvers.user_id both
-- ON DELETE CASCADE) -- when api/admin/actions.js's deleteUser removes an
-- account via the service-role client, those cascades fire with no JWT
-- context, so auth.uid() is null. Without this guard, actor_label's NOT
-- NULL constraint would abort the entire account deletion. A
-- system-cascaded removal isn't a distinct admin decision worth logging
-- on its own anyway -- user.deleted (logged separately, see
-- api/admin/actions.js) already captures that the account is gone.
-- ----------------------------------------------------------------------------

create or replace function log_skill_library_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is not null and new.status is distinct from old.status then
    insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label)
    values (
      v_caller,
      admin_activity_actor_label(v_caller),
      case when new.status = 'active' then 'skill.activated' else 'skill.deactivated' end,
      'skill_library',
      new.id,
      new.name
    );
  end if;
  return new;
end;
$$;

-- Not currently reachable by anon/authenticated directly (Postgres refuses
-- to invoke a `returns trigger` function outside trigger context), but
-- revoked anyway for consistency with every other function in this file
-- and as defense-in-depth against that assumption changing.
revoke all on function log_skill_library_activity() from public;

create trigger log_skill_library_activity_trigger
  after update on skill_library
  for each row execute procedure log_skill_library_activity();

create or replace function log_tag_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is not null and new.is_blacklisted is distinct from old.is_blacklisted then
    insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label)
    values (
      v_caller,
      admin_activity_actor_label(v_caller),
      case when new.is_blacklisted then 'tag.blacklisted' else 'tag.unblacklisted' end,
      'tag',
      new.id,
      new.name
    );
  end if;
  return new;
end;
$$;

revoke all on function log_tag_activity() from public;

create trigger log_tag_activity_trigger
  after update on tags
  for each row execute procedure log_tag_activity();

create or replace function log_organisation_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is not null and new.status is distinct from old.status then
    insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label)
    values (
      v_caller,
      admin_activity_actor_label(v_caller),
      case when new.status = 'active' then 'organisation.activated' else 'organisation.suspended' end,
      'organisation',
      new.id,
      new.name
    );
  end if;
  return new;
end;
$$;

revoke all on function log_organisation_activity() from public;

create trigger log_organisation_activity_trigger
  after update on organisations
  for each row execute procedure log_organisation_activity();

create or replace function log_catalogue_approver_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is not null then
    insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label, metadata)
    values (
      v_caller,
      admin_activity_actor_label(v_caller),
      'catalogue_approver.added',
      'catalogue_approver',
      new.id,
      admin_activity_actor_label(new.user_id),
      jsonb_build_object('catalogue_id', new.catalogue_id)
    );
  end if;
  return new;
end;
$$;

revoke all on function log_catalogue_approver_added() from public;

create trigger log_catalogue_approver_added_trigger
  after insert on catalogue_approvers
  for each row execute procedure log_catalogue_approver_added();

create or replace function log_catalogue_approver_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is not null then
    insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label, metadata)
    values (
      v_caller,
      admin_activity_actor_label(v_caller),
      'catalogue_approver.removed',
      'catalogue_approver',
      old.id,
      admin_activity_actor_label(old.user_id),
      jsonb_build_object('catalogue_id', old.catalogue_id)
    );
  end if;
  return old;
end;
$$;

revoke all on function log_catalogue_approver_removed() from public;

create trigger log_catalogue_approver_removed_trigger
  after delete on catalogue_approvers
  for each row execute procedure log_catalogue_approver_removed();

create or replace function log_organisation_member_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is not null then
    insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label, metadata)
    values (
      v_caller,
      admin_activity_actor_label(v_caller),
      'org_member.removed',
      'organisation_member',
      old.id,
      admin_activity_actor_label(old.user_id),
      jsonb_build_object('organisation_id', old.organisation_id, 'role', old.role)
    );
  end if;
  return old;
end;
$$;

revoke all on function log_organisation_member_removed() from public;

create trigger log_organisation_member_removed_trigger
  after delete on organisation_members
  for each row execute procedure log_organisation_member_removed();

-- employer_member.added is logged from api/admin/actions.js's
-- addEmployerMember instead of a mirroring AFTER INSERT trigger here --
-- that insert runs via the service-role client (no authenticated session,
-- so no auth.uid() for a trigger to attribute it to), but the handler
-- already has the verified caller's id from its own auth check, so
-- logging explicitly there is strictly more accurate than a trigger could
-- be. employer_member.removed (below) goes through the user's own
-- authenticated session (removeOrganisationMember's employer-console
-- equivalent), where auth.uid() is available, so a trigger works there.
create or replace function log_employer_member_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is not null then
    insert into admin_activity_log (actor_id, actor_label, action, entity_type, entity_id, entity_label, metadata)
    values (
      v_caller,
      admin_activity_actor_label(v_caller),
      'employer_member.removed',
      'employer_member',
      old.id,
      admin_activity_actor_label(old.user_id),
      jsonb_build_object('employer_id', old.employer_id, 'role', old.role)
    );
  end if;
  return old;
end;
$$;

revoke all on function log_employer_member_removed() from public;

create trigger log_employer_member_removed_trigger
  after delete on employer_members
  for each row execute procedure log_employer_member_removed();
