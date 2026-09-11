-- Follow-up to 0064_account_deletion_cascades.sql and
-- 20260910110000_employer_members_account_deletion_cascade.sql: that first
-- migration fixed every FK to auth.users(id) that existed at the time, and
-- the second fixed employer_members/employers specifically after admin
-- deleteUser was reported failing for a user who'd been an employer
-- member. But every table below was *also* added after 0064 and was
-- missed the same way -- confirmed by grepping every migration for
-- "references auth.users(id)" with no ON DELETE action, then checking each
-- hit was never subsequently fixed. Deleting a user with a row in any of
-- these still fails today with the same FK-violation "PARTIAL FAILURE" admin
-- deleteUser already logs (api/admin/actions.js) -- this closes the gap
-- properly instead of piecemeal, table by table, every time it resurfaces.
--
-- Same two categories 0064 established:
--   CASCADE: rows the user owns outright, or that are *about* a specific
--     user and meaningless without them (an assignment/suggestion/request
--     targeting a learner, a share link to their own profile, their own
--     OAuth connection, their own activity-to-skill link).
--   SET NULL: pure attribution on a row that belongs to something else
--     (a team, a cohort, another learner's assignment/suggestion) and
--     should survive with its identifying FK stripped, same as
--     tags.created_by/skill_library.created_by before it. Three of these
--     columns are currently NOT NULL and must be relaxed first, exactly
--     as 0064 did for skill_peer_ratings.rater_id/skill_validation_
--     requests.validator_id.

-- ----------------------------------------------------------------------------
-- CASCADE: owned data, or rows that are about a specific user
-- ----------------------------------------------------------------------------
alter table external_connections drop constraint external_connections_user_id_fkey,
  add constraint external_connections_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table xapi_statement_skills drop constraint xapi_statement_skills_user_id_fkey,
  add constraint xapi_statement_skills_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table course_assignments drop constraint course_assignments_assigned_to_fkey,
  add constraint course_assignments_assigned_to_fkey foreign key (assigned_to) references auth.users(id) on delete cascade;

alter table employer_data_access_requests drop constraint employer_data_access_requests_learner_id_fkey,
  add constraint employer_data_access_requests_learner_id_fkey foreign key (learner_id) references auth.users(id) on delete cascade;

alter table employer_skill_suggestions drop constraint employer_skill_suggestions_learner_id_fkey,
  add constraint employer_skill_suggestions_learner_id_fkey foreign key (learner_id) references auth.users(id) on delete cascade;

alter table profile_share_links drop constraint profile_share_links_user_id_fkey,
  add constraint profile_share_links_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

-- ----------------------------------------------------------------------------
-- SET NULL: pure attribution, already nullable
-- ----------------------------------------------------------------------------
alter table course_cohorts drop constraint course_cohorts_created_by_fkey,
  add constraint course_cohorts_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;

alter table employer_data_access_requests drop constraint employer_data_access_requests_requested_by_fkey,
  add constraint employer_data_access_requests_requested_by_fkey foreign key (requested_by) references auth.users(id) on delete set null;

alter table employer_skill_suggestions drop constraint employer_skill_suggestions_assigned_by_fkey,
  add constraint employer_skill_suggestions_assigned_by_fkey foreign key (assigned_by) references auth.users(id) on delete set null;

alter table employer_linked_providers drop constraint employer_linked_providers_linked_by_fkey,
  add constraint employer_linked_providers_linked_by_fkey foreign key (linked_by) references auth.users(id) on delete set null;

-- ----------------------------------------------------------------------------
-- SET NULL: pure attribution, currently NOT NULL -- relax first
-- ----------------------------------------------------------------------------
alter table course_assignments alter column assigned_by drop not null;
alter table course_assignments drop constraint course_assignments_assigned_by_fkey,
  add constraint course_assignments_assigned_by_fkey foreign key (assigned_by) references auth.users(id) on delete set null;

alter table manager_team_skill_suggestions alter column suggested_by drop not null;
alter table manager_team_skill_suggestions drop constraint manager_team_skill_suggestions_suggested_by_fkey,
  add constraint manager_team_skill_suggestions_suggested_by_fkey foreign key (suggested_by) references auth.users(id) on delete set null;

alter table manager_team_skills alter column added_by drop not null;
alter table manager_team_skills drop constraint manager_team_skills_added_by_fkey,
  add constraint manager_team_skills_added_by_fkey foreign key (added_by) references auth.users(id) on delete set null;
