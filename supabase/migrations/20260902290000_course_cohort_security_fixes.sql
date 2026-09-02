-- Security review fixes for the cohorts feature (20260902270000,
-- 20260902280000), before it ships. Three issues:
--
-- 1. course_cohorts/course_cohort_sessions' own SELECT policies (and
--    get_cohort_seat_counts' internal re-check) gated their public branch on
--    `cc.status = 'approved'` alone. course_catalogue's own *actual current*
--    select policy (0111, post 20260901100000) additionally requires
--    `is_current_published and is_course_published_to_catalogue(id)` -- a
--    course can be 'approved' with zero catalogues selected, deliberately
--    kept private to its own organisation (20260901100000's own comment:
--    "never distributed anywhere outside its own organisation"). Omitting
--    those two conditions let any authenticated learner platform-wide see
--    cohort names/dates/capacity and full session schedules (including
--    location_or_link, which may hold internal meeting URLs) for courses
--    meant to stay org-private.
--
-- 2. courses.cohort_id was directly writable by any authenticated learner
--    via the existing blanket "Users manage their own courses" policy
--    (0003, `for all using/with check auth.uid() = user_id`, no column
--    restriction) -- a direct API insert/update could set/switch cohort_id
--    on an owned courses row with no capacity/enrolment_open check at all,
--    bypassing enrol_in_course_cohort entirely. RLS can't express "only
--    this function may set this column", so this needs a trigger: reject
--    any attempt to set cohort_id to a new non-null value unless a
--    transaction-local guard (set by enrol_in_course_cohort itself, right
--    after its capacity check passes) is present. A transition *to* null
--    (unenrolling, or course_cohorts' own "on delete set null" cascade) is
--    always allowed -- only claiming a cohort is guarded.
--
-- 3. enrol_in_course_cohort's optional skill_course_links insert is
--    security definer, bypassing that table's own INSERT policy (0018:
--    `exists (select 1 from skills where id = skill_id and user_id =
--    auth.uid())`) -- a caller could pass an arbitrary p_skill_id belonging
--    to a different learner and the insert would succeed (the FK only
--    requires the skill to exist, not be owned by the caller). Restated
--    explicitly since security definer skips the RLS check that would
--    normally catch this.

-- ----------------------------------------------------------------------------
-- Fix 1: SELECT policy visibility, matching course_catalogue's own current
-- select policy exactly (0111).

drop policy "View cohorts for viewable courses" on course_cohorts;
create policy "View cohorts for viewable courses"
  on course_cohorts for select
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_cohorts.course_catalogue_id
        and (
          (cc.status = 'approved' and cc.is_current_published and is_course_published_to_catalogue(cc.id))
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
        )
    )
  );

drop policy "View sessions for viewable cohorts" on course_cohort_sessions;
create policy "View sessions for viewable cohorts"
  on course_cohort_sessions for select
  to authenticated
  using (
    exists (
      select 1 from course_cohorts cch
      join course_catalogue cc on cc.id = cch.course_catalogue_id
      where cch.id = course_cohort_sessions.cohort_id
        and (
          (cc.status = 'approved' and cc.is_current_published and is_course_published_to_catalogue(cc.id))
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
        )
    )
  );

-- Same fix inside get_cohort_seat_counts' own visibility re-check (it's
-- security definer, bypassing the policies above entirely, so this has to
-- be restated here too).
create or replace function get_cohort_seat_counts(p_cohort_ids uuid[])
returns table (cohort_id uuid, enrolled_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select c.cohort_id, count(*) as enrolled_count
  from courses c
  where c.cohort_id = any (p_cohort_ids)
    and exists (
      select 1 from course_cohorts cch
      join course_catalogue cc on cc.id = cch.course_catalogue_id
      where cch.id = c.cohort_id
        and (
          (cc.status = 'approved' and cc.is_current_published and is_course_published_to_catalogue(cc.id))
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c2 where c2.catalogue_course_id = cc.id and c2.user_id = auth.uid())
        )
    )
  group by c.cohort_id
$$;

revoke all on function get_cohort_seat_counts(uuid[]) from public, anon, authenticated;
grant execute on function get_cohort_seat_counts(uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- Fix 2: cohort_id can only ever become (or change to) a non-null value via
-- a successful enrol_in_course_cohort call. set_config's third arg (true)
-- makes the guard transaction-local -- it resets automatically at the end
-- of the transaction/RPC call, so it can never leak across separate
-- requests (each PostgREST call is its own transaction) and there's no
-- cleanup to forget.
create or replace function guard_courses_cohort_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.cohort_id is not null and (tg_op = 'INSERT' or new.cohort_id is distinct from old.cohort_id) then
    if current_setting('app.enrolling_via_rpc', true) is distinct from 'true' then
      raise exception 'cohort_id can only be set by enrolling through enrol_in_course_cohort';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_courses_cohort_id_trigger on courses;
create trigger guard_courses_cohort_id_trigger
  before insert or update on courses
  for each row
  execute function guard_courses_cohort_id();

-- ----------------------------------------------------------------------------
-- Fix 3 (+ sets the Fix 2 guard before its own insert): re-declare
-- enrol_in_course_cohort with the ownership check restated (mirrors the RLS
-- check on skill_course_links this security-definer function otherwise
-- bypasses) and the transaction-local guard set right after the capacity
-- check passes, immediately before the insert it protects.
create or replace function enrol_in_course_cohort(p_cohort_id uuid, p_skill_id uuid default null)
returns courses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_cohort course_cohorts%rowtype;
  v_course course_catalogue%rowtype;
  v_existing_count int;
  v_course_row courses%rowtype;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_cohort from course_cohorts where id = p_cohort_id for update;
  if not found then
    raise exception 'Cohort not found';
  end if;

  if not v_cohort.enrolment_open then
    raise exception 'Enrolment for this cohort is closed';
  end if;

  -- Still holding the row lock above, so a concurrent enrolment on this
  -- same cohort can't slip in between this count and the insert below.
  select count(*) into v_existing_count from courses where cohort_id = p_cohort_id;
  if v_cohort.capacity is not null and v_existing_count >= v_cohort.capacity then
    raise exception 'This cohort is full';
  end if;

  select * into v_course from course_catalogue where id = v_cohort.course_catalogue_id;
  if not found then
    raise exception 'Course not found';
  end if;

  if p_skill_id is not null and not exists (
    select 1 from skills where id = p_skill_id and user_id = v_caller
  ) then
    raise exception 'Skill not found or not owned by the caller';
  end if;

  -- Transaction-local: cleared automatically once this call's transaction
  -- ends, so it can never carry over to a later, unrelated request.
  perform set_config('app.enrolling_via_rpc', 'true', true);

  insert into courses (user_id, name, provider, course_type, duration, catalogue_course_id, cohort_id)
  values (v_caller, v_course.name, v_course.provider, v_course.course_type, v_course.duration, v_course.id, v_cohort.id)
  returning * into v_course_row;

  if p_skill_id is not null then
    insert into skill_course_links (user_id, skill_id, course_id, relationship)
    values (v_caller, p_skill_id, v_course_row.id, 'developed');
  end if;

  return v_course_row;
end;
$$;

revoke all on function enrol_in_course_cohort(uuid, uuid) from public, anon, authenticated;
grant execute on function enrol_in_course_cohort(uuid, uuid) to authenticated;
