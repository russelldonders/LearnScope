-- Security fix found by review of Phase 5 (employer_data_access_requests,
-- 20260902200000): has_employer_data_access only checked that the request
-- row was 'approved' and that the checking user was an active admin of that
-- employer -- it never re-verified the LEARNER was still an active member of
-- that employer. removeEmployerMember (src/lib/admin/employers.js) just
-- deletes the employer_members row; it doesn't touch
-- employer_data_access_requests. So a learner who shared/approved access
-- and later left (or was removed from) the employer kept being visible to
-- that employer's admins indefinitely, until they manually revoked from
-- Profile Privacy themselves -- a residual-access gap against CLAUDE.md's
-- learner-ownership/privacy-by-design principle.
--
-- Same fix shape as 20260902170000's tightening of is_employer_admin/
-- is_employer_member: add the missing membership-status check to the one
-- function everything else already depends on, rather than trying to hunt
-- down and patch every place that removes an employer_members row.
-- is_employer_member (20260902090000, hardened in 20260902170000) already
-- requires status = 'active', so this one-line addition is sufficient.

create or replace function has_employer_data_access(p_learner_id uuid, p_check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from employer_data_access_requests r
    where r.learner_id = p_learner_id
      and r.status = 'approved'
      and is_employer_admin(r.employer_id, p_check_user_id)
      and is_employer_member(r.employer_id, r.learner_id)
  )
$$;
