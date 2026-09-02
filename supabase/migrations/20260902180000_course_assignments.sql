-- Phase 3 of the employer domain concept (follows 20260902090000/150000/
-- 160000): lets an employer admin push/assign a course to specific
-- employer_members, rather than 100% learner-initiated discovery via the
-- catalogue browse page (courseCatalogue.js's listCatalogueCourses/
-- enrolInCatalogueCourse, both left completely untouched by this phase).
--
-- Deliberately a lighter trust boundary than Phase 2's employer_members
-- invite: assignment doesn't grant the employer any access to the learner's
-- data and doesn't create anything on their profile by itself, so an admin
-- can create a course_assignments row without the learner's prior consent
-- -- that's the whole point of "push". What it must NOT do is silently
-- enrol them: creating the real `courses` row that becomes part of the
-- learner's own record stays an action only the learner takes (clicking
-- "Start" on /actions, via respondToCourseAssignment ->
-- enrolInCatalogueCourse, unchanged). This table only ever tracks the
-- assignment's own lifecycle (assigned/enrolled/dismissed); it is never the
-- thing that shows up on a learner's profile.
create table course_assignments (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references employers(id) on delete cascade,
  catalogue_course_id uuid not null references course_catalogue(id) on delete cascade,
  assigned_to uuid not null references auth.users(id),
  assigned_by uuid not null references auth.users(id),
  status text not null default 'assigned' check (status in ('assigned', 'enrolled', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (employer_id, catalogue_course_id, assigned_to)
);

create index course_assignments_assigned_to_idx on course_assignments (assigned_to);
create index course_assignments_employer_idx on course_assignments (employer_id);

alter table course_assignments enable row level security;

-- A learner sees their own assignments (whatever their status); an employer
-- admin sees every assignment they've made, for a roster/status view of
-- who's started/dismissed/still pending across their own employer.
create policy "Learners and employer admins can view course assignments"
  on course_assignments for select
  to authenticated
  using (
    assigned_to = (select auth.uid())
    or is_employer_admin(employer_id, (select auth.uid()))
  );

-- No insert policy -- creation only happens through
-- assign_course_to_employer_members() below (security definer, validates
-- admin status and catalogue eligibility server-side), same reasoning as
-- employers/employer_members having no open insert/creation path either.

-- The learner transitions their own row's status: 'enrolled' once they've
-- actually enrolled via the existing, unchanged enrolInCatalogueCourse flow
-- (respondToCourseAssignment, src/lib/courseCatalogue.js), or 'dismissed' if
-- they don't want it. Low-stakes self-service state on their own row, not a
-- security boundary -- not worth a transition-validity trigger for e.g.
-- dismissed -> assigned.
create policy "Learners can update their own assignment status"
  on course_assignments for update
  to authenticated
  using (assigned_to = (select auth.uid()))
  with check (assigned_to = (select auth.uid()));

-- Lets an admin retract an assignment (assigned the wrong course/person).
create policy "Employer admins can delete course assignments"
  on course_assignments for delete
  to authenticated
  using (is_employer_admin(employer_id, (select auth.uid())));

grant select, update, delete on table course_assignments to authenticated;

-- ----------------------------------------------------------------------------
-- assign_course_to_employer_members -- security definer, mirrors
-- assign_course_to_catalogue's (20260831121500) validated-insert-with-
-- on-conflict shape: check the caller's admin status and the course's
-- eligibility server-side, then do the insert. Grant execute to
-- authenticated (same convention as every other employer RPC) since the
-- internal is_employer_admin check is what actually enforces admin-only.
--
-- Eligibility is deliberately narrower than the platform-wide browse
-- catalogue (listCatalogueCourses): an employer admin may only assign a
-- course that is actually published in a catalogue belonging to their own
-- attached provider org (catalogues.organisation_id =
-- employers.provider_organisation_id) -- their own org's training, not
-- anything platform-wide approved elsewhere.
--
-- The insert/select/on-conflict is one statement doing double duty: it
-- filters p_user_ids down to actual active employer_members of this
-- employer (both roles -- admin or member -- assignable; nothing about
-- being an employer admin excludes you from also being assigned training),
-- and it dedupes against any existing assignment via the unique constraint.
-- returns setof course_assignments so the caller can tell exactly which of
-- the requested users actually got a new row, and report the rest as
-- skipped rather than claiming a uniform success.
create or replace function assign_course_to_employer_members(
  p_employer_id uuid,
  p_catalogue_course_id uuid,
  p_user_ids uuid[]
)
returns setof course_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_provider_organisation_id uuid;
begin
  if v_caller is null or not is_employer_admin(p_employer_id, v_caller) then
    raise exception 'Not authorized';
  end if;

  select provider_organisation_id into v_provider_organisation_id
  from employers
  where id = p_employer_id;

  if v_provider_organisation_id is null then
    raise exception 'Employer not found';
  end if;

  if not exists (
    select 1
    from course_catalogue_publications pub
    join catalogues c on c.id = pub.catalogue_id
    where pub.course_id = p_catalogue_course_id
      and pub.published_at is not null
      and c.organisation_id = v_provider_organisation_id
  ) then
    raise exception 'This course is not published in your organisation''s own catalogue';
  end if;

  return query
    insert into course_assignments (employer_id, catalogue_course_id, assigned_to, assigned_by)
    select p_employer_id, p_catalogue_course_id, uid.user_id, v_caller
    from unnest(p_user_ids) as uid(user_id)
    where exists (
      select 1 from employer_members
      where employer_id = p_employer_id
        and user_id = uid.user_id
        and status = 'active'
    )
    on conflict (employer_id, catalogue_course_id, assigned_to) do nothing
    returning *;
end;
$$;

revoke all on function assign_course_to_employer_members(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function assign_course_to_employer_members(uuid, uuid, uuid[]) to authenticated;
