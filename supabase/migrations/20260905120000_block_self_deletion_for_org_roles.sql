-- Fixes account self-deletion for two groups it currently breaks outright,
-- and makes the resulting behaviour deliberate rather than accidental.
--
-- employer_members.user_id (20260902090000) has no ON DELETE action against
-- auth.users(id). Any user holding a row there -- employer admin or member,
-- active or still-pending invite -- makes admin.auth.admin.deleteUser() fail
-- with a raw foreign-key violation, so they cannot delete their account at
-- all. organisation_members.user_id (0065) does cascade, so that half was
-- never blocked by the database -- but a person doing active admin/trainer
-- work for a training-provider organisation, or active employer admin/member
-- work for an employer, is not solely a personal account; letting them
-- unilaterally vanish would delete organisation-side capability out from
-- under the organisation without its knowledge. Both cases should be an
-- explicit, actionable block -- "ask that organisation to remove you first"
-- -- rather than either a crash or a silent cascade.
--
-- A merely pending (not yet accepted) invite is not an org role yet, so it
-- does not block deletion -- it is just cleared so it can't trip the
-- employer_members FK.

create or replace function delete_own_account_scrub()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if exists (
    select 1 from employer_members
    where user_id = auth.uid() and status = 'active'
  ) then
    raise exception 'Your account is an active member of an employer organisation. Ask an admin there to remove you before deleting your account.'
      using errcode = 'LS001';
  end if;

  if exists (
    select 1 from organisation_members
    where user_id = auth.uid() and status = 'active'
  ) then
    raise exception 'Your account is active staff on a training provider organisation. Ask an admin there to remove you before deleting your account.'
      using errcode = 'LS001';
  end if;

  -- Neither an active employer member nor active organisation staff --
  -- clear any stale pending employer invite so it can't block the
  -- auth.users delete below (organisation_members already cascades).
  delete from employer_members where user_id = auth.uid();

  update skill_peer_ratings
  set rater_name = null, rater_email = null
  where rater_id = auth.uid();

  update skill_validation_requests
  set status = 'declined', decided_at = now(),
    decision_comments = coalesce(decision_comments, 'Validator account was deleted.')
  where validator_id = auth.uid() and status = 'pending';

  delete from skill_library where created_by = auth.uid() and is_private;
end;
$$;
