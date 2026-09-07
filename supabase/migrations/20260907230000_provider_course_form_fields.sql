-- Provider course create/edit screen improvements:
-- 1. Structured duration (value + unit) alongside the existing free-text
--    `duration` column, which stays populated (composed from the new
--    columns by the frontend save functions) so every existing display
--    site (catalogue listings, provider profile, enrol_in_course_cohort)
--    keeps working untouched. The new columns exist only so the edit
--    screen can re-populate a number+unit picker instead of trying to
--    parse old free text like "3 years" or "self-paced" back apart.
-- 2. Cohorts: name becomes optional (a cohort can be identified by its
--    dates alone), plus end_date and location.
-- 3. Two new trainer join tables -- one for the course as a whole, one per
--    cohort -- deliberately reusing the existing organisation_members
--    identity (no new "trainer" concept invented) rather than a free-text
--    name field, so a trainer is always a real, addressable org member.

alter table course_catalogue
  add column duration_value numeric,
  add column duration_unit text check (duration_unit in ('mins', 'hours', 'days', 'weeks'));

alter table course_cohorts
  alter column name drop not null,
  add column end_date date,
  add column location text;

create table course_trainers (
  course_catalogue_id uuid not null references course_catalogue(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (course_catalogue_id, user_id)
);

create table course_cohort_trainers (
  cohort_id uuid not null references course_cohorts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (cohort_id, user_id)
);

create index course_trainers_course_catalogue_id_idx on course_trainers (course_catalogue_id);
create index course_cohort_trainers_cohort_id_idx on course_cohort_trainers (cohort_id);

alter table course_trainers enable row level security;
alter table course_cohort_trainers enable row level security;

-- Same visibility as the course itself (mirrors "View cohorts for viewable
-- courses", 20260902270000).
create policy "View trainers for viewable courses"
  on course_trainers for select
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_trainers.course_catalogue_id
        and (
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
        )
    )
  );

create policy "View trainers for viewable cohorts"
  on course_cohort_trainers for select
  to authenticated
  using (
    exists (
      select 1 from course_cohorts cch
      join course_catalogue cc on cc.id = cch.course_catalogue_id
      where cch.id = course_cohort_trainers.cohort_id
        and (
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c where c.catalogue_course_id = cc.id and c.user_id = auth.uid())
        )
    )
  );

-- Manage bar matches cohort management's own authorization (not
-- course_catalogue's own update policy, which additionally requires
-- status in ('draft','rejected') -- deliberately not applied here for the
-- same reason cohort management itself isn't restricted to draft/rejected:
-- who's training an already-approved, already-published course is an
-- operational detail, not a core content edit). The target user_id must
-- also actually be an active member of the course's own organisation --
-- a trainer is always a real org member, never an arbitrary uuid.
create policy "Org members manage trainers for their own courses"
  on course_trainers for all
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_trainers.course_catalogue_id
        and (
          is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
        )
    )
  )
  with check (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_trainers.course_catalogue_id
        and (
          is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
        )
        and cc.organisation_id is not null
        and exists (
          select 1 from organisation_members om
          where om.organisation_id = cc.organisation_id
            and om.user_id = course_trainers.user_id
            and om.status = 'active'
        )
    )
  );

create policy "Org members manage trainers for their own courses' cohorts"
  on course_cohort_trainers for all
  to authenticated
  using (
    exists (
      select 1 from course_cohorts cch
      join course_catalogue cc on cc.id = cch.course_catalogue_id
      where cch.id = course_cohort_trainers.cohort_id
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
      where cch.id = course_cohort_trainers.cohort_id
        and (
          is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
        )
        and cc.organisation_id is not null
        and exists (
          select 1 from organisation_members om
          where om.organisation_id = cc.organisation_id
            and om.user_id = course_cohort_trainers.user_id
            and om.status = 'active'
        )
    )
  );

grant select, insert, update, delete on table course_trainers to authenticated;
grant select, insert, update, delete on table course_cohort_trainers to authenticated;
