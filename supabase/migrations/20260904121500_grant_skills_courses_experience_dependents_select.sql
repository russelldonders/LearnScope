-- Found while writing SQL allow/deny tests for
-- 20260904120000_skills_courses_experience_dependents_access_helper.sql: a
-- fresh local `supabase db reset` leaves `authenticated` without SELECT on
-- any of these eleven tables. Same root cause and same verdict as
-- 20260904100000_grant_connections_select.sql and
-- 20260904111500_grant_courses_select.sql: none of these tables ever got an
-- explicit GRANT in a migration, and the linked Staging project's Postgres
-- instance has an ambient default ACL (outside any migration) that grants
-- authenticated full table privileges on new tables automatically, so this
-- is not currently broken for real users on Staging. Fixed here for local
-- dev and for stage_bootstrap_consolidated.sql's from-empty bootstrap case.
--
-- The existing RLS policies on all eleven tables already scope visible rows
-- correctly, so a blanket SELECT grant is safe regardless of environment.
-- xapi_launch_sessions is included here even though
-- 20260904120000_skills_courses_experience_dependents_access_helper.sql
-- deliberately did NOT add a linked-account policy to it (see that
-- migration's comment: its `token` column is a bearer credential, not
-- read-only data) -- this grant only restores the table's own pre-existing
-- owner-only "Users view their own xapi launch sessions" policy locally; it
-- grants nothing new to a linked account, since no additional policy exists
-- for one to use.

grant select on
  public.course_content_progress,
  public.course_experience_links,
  public.skill_assessments,
  public.skill_baseline_quizzes,
  public.skill_course_links,
  public.skill_experience_links,
  public.skill_tags,
  public.skill_targets,
  public.xapi_launch_sessions,
  public.xapi_statement_skills,
  public.xapi_statements
to authenticated;
