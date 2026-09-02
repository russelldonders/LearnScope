-- CRITICAL security fix, found by security review of Phase 2 (employer
-- invite-with-consent, 20260902160000).
--
-- is_employer_admin/is_employer_member (20260902090000) never filtered on
-- employer_members.status -- unlike the org equivalents they were supposed
-- to mirror, is_org_admin/is_org_member (0070), which explicitly require
-- status = 'active' because "a pending row grants no access yet." That
-- check never made it into the employer versions.
--
-- This was latent and harmless in Phase 1 (nothing created a 'pending'
-- employer_members row back then -- addEmployerMember only ever inserted
-- 'active' rows for an existing user). Phase 2's addEmployerMember
-- existing-user branch now creates real, reachable 'pending' rows, so a
-- user invited as role='admin' but who has NOT accepted anything already
-- satisfied is_employer_admin -- meaning they could, via a direct
-- supabase.from('employer_members') call bypassing the app UI entirely:
-- read the full membership roster for that employer (is_employer_member
-- also passed, so employers'/employer_members' SELECT policies passed
-- too), UPDATE their own row to status='active' directly (skipping
-- decide_employer_invite and its consent check), and INSERT/UPDATE/DELETE
-- other members' rows (add an accomplice as admin, remove real admins).

create or replace function is_employer_admin(p_employer_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from employer_members
    where employer_id = p_employer_id and user_id = check_user_id and role = 'admin' and status = 'active'
  ) or is_platform_admin(check_user_id)
$$;

create or replace function is_employer_member(p_employer_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from employer_members
    where employer_id = p_employer_id and user_id = check_user_id and status = 'active'
  ) or is_platform_admin(check_user_id)
$$;

-- Requiring status = 'active' above breaks a pending invitee's ability to
-- see their OWN pending row -- both employer_members' own select policy and
-- the /actions "Employer invitations" card (listMyPendingEmployerInvites)
-- depend on is_employer_member, which no longer matches a pending row.
-- Mirrors organisation_members' own equivalent fix (0070, "Users can view
-- their own organisation membership rows") exactly: any user can always see
-- their own membership row, whatever its status -- there's nothing private
-- about a person seeing that they themselves are a pending invitee.
create policy "Users can view their own employer_members rows"
  on employer_members for select
  to authenticated
  using (auth.uid() = user_id);

-- organisations' own SELECT policy is intentionally open to any
-- authenticated user ("any authenticated user can view" -- providers are a
-- public directory), which is why the equivalent problem never arose on the
-- org side: listMyPendingOrgInvites' organisations(id, name) join always
-- resolves regardless of membership status. employers is deliberately NOT
-- open like that (private company entities, select scoped to members via
-- is_employer_member) -- so tightening is_employer_member above would
-- otherwise silently break listMyPendingEmployerInvites' own
-- employers(id, name) join for a pending invitee (the employer row itself
-- would no longer resolve, even though their own employer_members row
-- still does via the policy just above). Narrow, explicit fix: let a user
-- see the name of any employer they have ANY employer_members row for
-- (pending or active) -- not employer membership generally, just enough to
-- resolve the employer's own name/id for their invitation card. Platform
-- admins and active members remain covered by the existing
-- is_employer_member-gated "Employer members can view their employer"
-- policy (its is_platform_admin bypass is unaffected by the status
-- tightening above).
create policy "Invitees can view the employer they're invited to"
  on employers for select
  to authenticated
  using (
    exists (
      select 1 from employer_members
      where employer_members.employer_id = employers.id
        and employer_members.user_id = auth.uid()
    )
  );
