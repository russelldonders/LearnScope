-- Makes account deletion (auth.admin.deleteUser) actually work. Today only
-- profiles.id cascades from auth.users -- every other FK to auth.users(id)
-- has no ON DELETE action, which blocks deletion outright. This migration
-- only changes constraint behaviour; it does not touch any existing data.
--
-- Three categories:
--   1. CASCADE: rows the user owns outright, or pure relationship/pending
--      rows (connections, requests, invites) that have no meaning once one
--      party no longer exists.
--   2. SET NULL: rows that remain another learner's evidence even after the
--      referenced user is gone -- a peer rating given, a skill validation
--      performed -- so the row survives with its identifying FK stripped.
--      Two of these columns are currently NOT NULL and must be relaxed
--      first.
--   3. SET NULL on the two shared-catalog "created_by" columns (tags,
--      skill_library) -- these must never cascade, since deleting the
--      creator's account would otherwise delete a tag/library entry other
--      learners have already applied to their own skills.

-- ----------------------------------------------------------------------------
-- 1. Owned data + pure relationship/pending rows -- CASCADE
-- ----------------------------------------------------------------------------
alter table skills drop constraint skills_user_id_fkey,
  add constraint skills_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table courses drop constraint courses_user_id_fkey,
  add constraint courses_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table experience drop constraint experience_user_id_fkey,
  add constraint experience_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table skill_assessments drop constraint skill_assessments_user_id_fkey,
  add constraint skill_assessments_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table xapi_statements drop constraint xapi_statements_user_id_fkey,
  add constraint xapi_statements_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table skill_baseline_quizzes drop constraint skill_baseline_quizzes_user_id_fkey,
  add constraint skill_baseline_quizzes_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table skill_targets drop constraint skill_targets_user_id_fkey,
  add constraint skill_targets_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table skill_course_links drop constraint skill_course_links_user_id_fkey,
  add constraint skill_course_links_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table skill_tags drop constraint skill_tags_user_id_fkey,
  add constraint skill_tags_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table course_experience_links drop constraint course_experience_links_user_id_fkey,
  add constraint course_experience_links_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table skill_experience_links drop constraint skill_experience_links_user_id_fkey,
  add constraint skill_experience_links_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table connections drop constraint connections_user_a_id_fkey,
  add constraint connections_user_a_id_fkey foreign key (user_a_id) references auth.users(id) on delete cascade;
alter table connections drop constraint connections_user_b_id_fkey,
  add constraint connections_user_b_id_fkey foreign key (user_b_id) references auth.users(id) on delete cascade;

alter table connection_requests drop constraint connection_requests_requester_id_fkey,
  add constraint connection_requests_requester_id_fkey foreign key (requester_id) references auth.users(id) on delete cascade;
alter table connection_requests drop constraint connection_requests_recipient_id_fkey,
  add constraint connection_requests_recipient_id_fkey foreign key (recipient_id) references auth.users(id) on delete cascade;

alter table connection_invites drop constraint connection_invites_inviter_id_fkey,
  add constraint connection_invites_inviter_id_fkey foreign key (inviter_id) references auth.users(id) on delete cascade;

alter table profile_searchable_skills drop constraint profile_searchable_skills_profile_id_fkey,
  add constraint profile_searchable_skills_profile_id_fkey foreign key (profile_id) references auth.users(id) on delete cascade;

alter table skill_peer_ratings drop constraint skill_peer_ratings_skill_owner_id_fkey,
  add constraint skill_peer_ratings_skill_owner_id_fkey foreign key (skill_owner_id) references auth.users(id) on delete cascade;

alter table skill_validation_requests drop constraint skill_validation_requests_requester_id_fkey,
  add constraint skill_validation_requests_requester_id_fkey foreign key (requester_id) references auth.users(id) on delete cascade;

-- ----------------------------------------------------------------------------
-- 2. Evidence another learner still relies on -- SET NULL
-- ----------------------------------------------------------------------------
alter table skill_peer_ratings alter column rater_id drop not null;
alter table skill_peer_ratings drop constraint skill_peer_ratings_rater_id_fkey,
  add constraint skill_peer_ratings_rater_id_fkey foreign key (rater_id) references auth.users(id) on delete set null;

alter table skill_validation_requests alter column validator_id drop not null;
alter table skill_validation_requests drop constraint skill_validation_requests_validator_id_fkey,
  add constraint skill_validation_requests_validator_id_fkey foreign key (validator_id) references auth.users(id) on delete set null;

alter table connection_invites drop constraint connection_invites_accepted_by_fkey,
  add constraint connection_invites_accepted_by_fkey foreign key (accepted_by) references auth.users(id) on delete set null;

-- ----------------------------------------------------------------------------
-- 3. Shared-catalog attribution -- SET NULL (never cascade: these rows are
-- used by other learners, deleting one user must not delete the tag/library
-- entry itself)
-- ----------------------------------------------------------------------------
alter table tags drop constraint tags_created_by_fkey,
  add constraint tags_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;

alter table skill_library drop constraint skill_library_created_by_fkey,
  add constraint skill_library_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;

-- ----------------------------------------------------------------------------
-- 4. Pre-deletion scrub: FK SET NULL above only clears rater_id, not the
-- denormalized rater_name/rater_email snapshot on skill_peer_ratings
-- (stored because a rater has no RLS access to the skill they rated -- see
-- 0010/0011). Must be called and committed before auth.admin.deleteUser(),
-- since auth.uid() stops resolving once the user row is gone. Mirrors the
-- existing SECURITY DEFINER precedent (accept_invite_and_rate,
-- decide_validation_request).
--
-- Also handles two things SET NULL alone would leave broken:
--   - a pending validation request naming this user as validator would
--     otherwise sit "pending" forever once validator_id goes null, with no
--     one able to act on it -- decline it instead, same as a real decision.
--   - a private skill_library entry only this user could ever see (RLS:
--     `not is_private or created_by = auth.uid()`) would otherwise become
--     permanently invisible dead data once created_by goes null. Delete it
--     outright; skills.library_skill_id/skill_diagnostic_content.library_
--     skill_id already handle a missing library row (set null / cascade).
-- ----------------------------------------------------------------------------
create or replace function delete_own_account_scrub()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

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

grant execute on function delete_own_account_scrub() to authenticated;
