-- Security-review follow-up on 20260902180000 (course assignment Phase 3).
--
-- 1. HIGH: course_assignments' UPDATE policy ("Learners can update their own
-- assignment status") only pins assigned_to in USING/WITH CHECK -- RLS can't
-- do column-grain checks (same bug class already found and fixed once in
-- this same PR, see 20260902150000_employers_drop_update_policy.sql's own
-- comment), and the table-wide `grant ... update ... to authenticated` let
-- any user holding a legitimate course_assignments row rewrite that row's
-- employer_id, catalogue_course_id, or assigned_by via a direct PostgREST
-- call -- e.g. repointing employer_id to an employer they don't belong to
-- and status to 'enrolled', polluting a different employer's roster with a
-- fake "completed" assignment with no real courses enrolment behind it.
-- Unlike employers' equivalent bug (dropped the policy entirely -- no
-- legitimate self-service update existed there), course_assignments has a
-- real, intended self-service update: the learner flipping their own row's
-- status to 'enrolled'/'dismissed' (respondToCourseAssignment,
-- src/lib/courseCatalogue.js, only ever sends {status}). Postgres enforces
-- column-level UPDATE privileges independently of RLS, and PostgREST
-- respects them, so narrowing the grant to just the one self-service column
-- keeps the real flow working while closing the other three off entirely --
-- no application code change needed.
revoke update on table course_assignments from authenticated;
grant update (status) on table course_assignments to authenticated;

-- 2. MEDIUM: assign_course_to_employer_members' eligibility check only
-- required course_catalogue_publications.published_at is not null plus
-- catalogue-organisation ownership -- missing the course_catalogue.status =
-- 'approved' and is_current_published = true filter every other reader of
-- this data applies (listCatalogueCourses, listPublishedProviderCourses,
-- is_course_published_to_catalogue, etc). deactivate_course_publication
-- only flips those two flags and never clears published_at, so a
-- deactivated/superseded course version stayed "eligible" per this RPC's
-- own check indefinitely, even though the course-picker UI already filters
-- correctly (listEmployerCatalogueCourses -> listPublishedProviderCourses)
-- and so never surfaces one. The RPC is meant to be the actual authority on
-- eligibility per its own comment -- this closes the gap so it actually is,
-- matching listPublishedProviderCourses' filter exactly.
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
    join course_catalogue cc on cc.id = pub.course_id
    where pub.course_id = p_catalogue_course_id
      and pub.published_at is not null
      and c.organisation_id = v_provider_organisation_id
      and cc.status = 'approved'
      and cc.is_current_published = true
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
