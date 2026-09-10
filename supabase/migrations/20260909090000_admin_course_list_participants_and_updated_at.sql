-- Platform Admin Courses backlog items: participant counts and a
-- last-updated date on the admin catalogue list (BACKLOG.md).

-- 1. Participant counts, bulk + count-only (mirrors count_skill_trackers/
-- get_cohort_seat_counts) -- a platform admin has no standing RLS access to
-- every learner's personal `courses` rows, and exposing raw enrolment rows
-- here would leak who's taking what beyond what's needed for a list-view
-- count. Scoped to platform admins only since this is purely for the admin
-- catalogue list, unlike count_skill_trackers's broader learner-facing use.
create or replace function count_course_participants_bulk(p_catalogue_course_ids uuid[])
returns table (catalogue_course_id uuid, participant_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select c.catalogue_course_id, count(distinct c.user_id) as participant_count
  from courses c
  where c.catalogue_course_id = any (p_catalogue_course_ids)
    and is_platform_admin((select auth.uid()))
  group by c.catalogue_course_id
$$;

revoke all on function count_course_participants_bulk(uuid[]) from public, anon, authenticated;
grant execute on function count_course_participants_bulk(uuid[]) to authenticated;

-- 2. Last-updated tracking. course_catalogue is mutated from several direct
-- client .update() calls (updateProviderCourse, course image upload/removal)
-- as well as multiple security-definer RPCs (publish_course_version,
-- reject_course_submission, deactivate_course_publication,
-- create_course_draft_version) -- a trigger is the only way to keep this
-- accurate across all of them without chasing down every call site.
alter table course_catalogue add column updated_at timestamptz not null default now();

create or replace function set_course_catalogue_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_course_catalogue_updated_at_trigger
  before update on course_catalogue
  for each row
  execute function set_course_catalogue_updated_at();
