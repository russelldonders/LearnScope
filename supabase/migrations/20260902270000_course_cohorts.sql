-- Cohorts: a specific scheduled run of a course_catalogue entry (e.g. "Jan
-- 2026 intake"), with one or more live sessions of its own. Purely additive
-- to the existing catalogue -- a course with no cohorts behaves exactly as
-- before (enrolInCatalogueCourse, src/lib/courseCatalogue.js, is completely
-- untouched), and a learner enrolling into a cohort still ends up with a
-- normal `courses` row, just with `cohort_id` set so their own record shows
-- which run (and which live sessions) they actually signed up for.
create table course_cohorts (
  id uuid primary key default gen_random_uuid(),
  course_catalogue_id uuid not null references course_catalogue(id) on delete cascade,
  name text not null,
  start_date date,
  -- null = unlimited seats.
  capacity int,
  -- Lets a provider manually stop taking enrolments before it's full (e.g.
  -- past a registration deadline) without having to set capacity at all.
  enrolment_open boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index course_cohorts_course_catalogue_id_idx on course_cohorts (course_catalogue_id);

create table course_cohort_sessions (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references course_cohorts(id) on delete cascade,
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  -- e.g. a meeting URL or a physical location -- free text, deliberately
  -- not modelled further (no separate "format" concept) since a provider
  -- may run one cohort with a mix of the two across its own sessions.
  location_or_link text,
  created_at timestamptz not null default now()
);

create index course_cohort_sessions_cohort_id_idx on course_cohort_sessions (cohort_id);

-- Nullable -- most enrolments (any course with no cohorts, or a cohort-less
-- enrolment into a course that has some) never set this at all.
alter table courses add column cohort_id uuid references course_cohorts(id) on delete set null;
create index courses_cohort_id_idx on courses (cohort_id);

alter table course_cohorts enable row level security;
alter table course_cohort_sessions enable row level security;

-- Same visibility as the parent course_catalogue row itself (0088's current
-- select policy: approved, platform admin, the owning org's own members, or
-- a learner already enrolled in that course) -- a learner needs to see a
-- course's cohorts/sessions to pick one before enrolling, including a
-- course they aren't enrolled in yet, so "already enrolled" is deliberately
-- not the only non-approved branch here (mirrors course_catalogue's own
-- policy, not a narrower one).
create policy "View cohorts for viewable courses"
  on course_cohorts for select
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_cohorts.course_catalogue_id
        and (
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
        )
    )
  );

create policy "View sessions for viewable cohorts"
  on course_cohort_sessions for select
  to authenticated
  using (
    exists (
      select 1 from course_cohorts cch
      join course_catalogue cc on cc.id = cch.course_catalogue_id
      where cch.id = course_cohort_sessions.cohort_id
        and (
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
        )
    )
  );

-- Manage bar matches course editing's own authorization (ProviderConsole.jsx:
-- "any org member (admin or trainer) can create training into their own
-- organisation_id") -- deliberately NOT course_catalogue's own org-member
-- update policy, which additionally requires status in ('draft','rejected')
-- for editing the course record itself. That restriction exists so a
-- published version's core details can't be silently rewritten -- it
-- doesn't apply here: a cohort is a scheduled run *of* an already-approved,
-- already-published course, so cohort management has to keep working once
-- the course is 'approved', not just while it's still a draft.
create policy "Org members manage cohorts for their own courses"
  on course_cohorts for all
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_cohorts.course_catalogue_id
        and (
          is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
        )
    )
  )
  with check (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_cohorts.course_catalogue_id
        and (
          is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
        )
    )
  );

create policy "Org members manage sessions for their own courses' cohorts"
  on course_cohort_sessions for all
  to authenticated
  using (
    exists (
      select 1 from course_cohorts cch
      join course_catalogue cc on cc.id = cch.course_catalogue_id
      where cch.id = course_cohort_sessions.cohort_id
        and (
          is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
        )
    )
  )
  with check (
    exists (
      select 1 from course_cohorts cch
      join course_catalogue cc on cc.id = cch.course_catalogue_id
      where cch.id = course_cohort_sessions.cohort_id
        and (
          is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
        )
    )
  );

-- Full CRUD table grants, same as 0111's catalogues/course_catalogue_
-- publications -- these are managed by direct RLS-gated statements from the
-- client (not RPC-only), unlike course_assignments' insert-only-via-RPC
-- shape.
grant select, insert, update, delete on table course_cohorts to authenticated;
grant select, insert, update, delete on table course_cohort_sessions to authenticated;

-- ----------------------------------------------------------------------------
-- enrol_in_course_cohort -- capacity-safe enrolment into a specific cohort.
-- security definer so it can lock the cohort row and count existing
-- enrolments atomically, serializing concurrent attempts on the same
-- cohort rather than racing two check-then-insert client calls past a
-- capacity limit. Performs the same insert enrolInCatalogueCourse already
-- does (src/lib/courseCatalogue.js) -- same columns, same optional
-- skill_course_links row -- plus cohort_id, so this is additive to that
-- flow rather than a parallel enrolment mechanism.
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

-- Explicit revoke-then-grant: Supabase auto-grants execute on a new
-- function to public/anon/authenticated by default, which would let an
-- unauthenticated (anon) caller invoke a security-definer function that
-- writes to `courses`. Matches every RPC added this session (e.g.
-- 20260902240000's fixes) -- revoke from all three, then grant execute to
-- authenticated only.
revoke all on function enrol_in_course_cohort(uuid, uuid) from public, anon, authenticated;
grant execute on function enrol_in_course_cohort(uuid, uuid) to authenticated;
