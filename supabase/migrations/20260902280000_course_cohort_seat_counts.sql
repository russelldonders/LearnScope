-- Seats-remaining needs an aggregate count of `courses` rows per cohort,
-- but courses' own RLS restricts a learner to their own rows only (0003) --
-- a provider org admin already sees every row for their own catalogue
-- course (0105's is_course_provider_admin), but an ordinary learner
-- browsing cohorts to pick one does not, so a plain client-side count
-- would silently undercount capacity for anyone but that admin. This
-- returns only aggregate counts (never individual enrolment rows), which
-- is the same "read past RLS for an operational aggregate, not identity"
-- reasoning enrol_in_course_cohort's own capacity check already relies on.
-- Only counts cohorts the caller is actually allowed to see (same
-- visibility rule as course_cohorts' own select policy, 20260902270000) --
-- being security definer bypasses that RLS policy entirely, so the
-- visibility check has to be re-stated here rather than relied on.
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
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
          or exists (select 1 from courses c2 where c2.catalogue_course_id = cc.id and c2.user_id = auth.uid())
        )
    )
  group by c.cohort_id
$$;

revoke all on function get_cohort_seat_counts(uuid[]) from public, anon, authenticated;
grant execute on function get_cohort_seat_counts(uuid[]) to authenticated;
