-- Follow-up to 20261114090000_course_learning_status (planned and cancelled
-- learning), from its security review.
--
-- 1. A cancelled cohort enrolment could be switched back on with a plain
--    update (status back to null or 'planned'). Its cohort_id doesn't change,
--    so guard_courses_cohort_id never ran, and the seat a cancellation frees
--    could be taken back past capacity or after enrolment closed. Taking a
--    cohort enrolment out of 'cancelled' now has to go through
--    enrol_in_course_cohort, which checks both.
--
-- 2. Other people who can read a learner's courses -- the course provider's
--    admins, someone validating a linked skill, an employer the learner gave
--    training consent -- now see real enrolments only. A plan is the
--    learner's own business, and a cancelled course isn't training done. The
--    learner (and their own linked accounts) still see everything.
--
-- 3. courses_cancelled_at_check let a cancelled_at through on a row with no
--    status (null = ... is null, which a check accepts).
--
-- No data changes: no row has a status yet outside testing, and the checks
-- only narrow what's allowed. Rollback: restore the previous trigger
-- function, the three policies' previous USING clauses (shown below without
-- "and status is null") and the previous constraint.

alter table public.courses drop constraint courses_cancelled_at_check;
alter table public.courses
  add constraint courses_cancelled_at_check check ((status is not distinct from 'cancelled') = (cancelled_at is not null));

create or replace function public.guard_courses_cohort_id()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.cohort_id is not null and (tg_op = 'INSERT' or new.cohort_id is distinct from old.cohort_id) then
    if current_setting('app.enrolling_via_rpc', true) is distinct from 'true' then
      raise exception 'cohort_id can only be set by enrolling through enrol_in_course_cohort';
    end if;
  end if;
  -- Re-activating a cancelled cohort enrolment takes a seat again, so it has
  -- to pass the same capacity and enrolment-open checks as enrolling.
  if tg_op = 'UPDATE' and new.cohort_id is not null
    and old.status is not distinct from 'cancelled' and new.status is distinct from 'cancelled' then
    if current_setting('app.enrolling_via_rpc', true) is distinct from 'true' then
      raise exception 'A cancelled cohort enrolment can only be re-activated by enrolling through enrol_in_course_cohort';
    end if;
  end if;
  return new;
end;
$function$;

drop policy "Provider admins can view their course participants" on public.courses;
create policy "Provider admins can view their course participants"
  on public.courses for select to authenticated
  using (
    catalogue_course_id is not null
    and is_course_provider_admin(catalogue_course_id, (select auth.uid()))
    and status is null
  );

drop policy "Validators can view courses linked to skills they're validating" on public.courses;
create policy "Validators can view courses linked to skills they're validating"
  on public.courses for select
  using (
    is_course_linked_to_validating_skill(id, (select auth.uid()))
    and status is null
  );

drop policy "Employers can view consented training" on public.courses;
create policy "Employers can view consented training"
  on public.courses for select to authenticated
  using (
    has_employer_category_access(user_id, 'training'::text)
    and status is null
  );
