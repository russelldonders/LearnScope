-- An employer admin already gets a real organisation_members admin row on
-- their employer's auto-provisioned attached provider organisation the
-- moment their employer_members admin role becomes active (addEmployerMember
-- for a brand-new account, decide_employer_invite's accept path for an
-- existing one -- 20260902090000/20260902160000). That grant is meant to be
-- an automatic, permanent consequence of being this employer's admin, not an
-- independently manage-able provider-staff relationship: nothing should be
-- able to remove it through the ordinary "remove organisation member" path
-- (OrganisationStaffPanel, reused verbatim inside the employer console's
-- Users tab) while they remain an active employer admin, since that would
-- silently break their access to the Training/Skills/Catalogues/Resources
-- tabs the employer console surfaces for them, with no employer-side sign
-- that anything changed.
--
-- Enforced with a BEFORE DELETE trigger rather than only a UI guard, so it
-- holds regardless of caller (the reused staff panel, a future admin tool,
-- or a direct client call) -- an RLS USING clause on DELETE can only make
-- the row invisible to remove, not explain why, and this needs a clear
-- error message. Removing the person's employer-admin role itself (via
-- removeEmployerMember, or a future demotion path) is unaffected by this
-- trigger and remains the correct way to end their employer-admin status;
-- it does not itself revoke this provider grant today, which stays a known,
-- separate limitation.

-- Deliberately does NOT fire when auth.users no longer has this user_id:
-- organisation_members.user_id references auth.users(id) ON DELETE CASCADE,
-- so deleting an account that still holds an active employer-admin role
-- would otherwise cascade into this same trigger and abort the whole
-- account deletion with this function's own exception. Once the user row
-- is gone there is nothing left to protect.
create or replace function prevent_employer_admin_provider_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from auth.users where id = old.user_id)
    and exists (
      select 1
      from employer_members em
      join employers e on e.id = em.employer_id
      where em.user_id = old.user_id
        and em.role = 'admin'
        and em.status = 'active'
        and e.provider_organisation_id = old.organisation_id
    )
  then
    raise exception 'This access is automatic while they are an admin of the linked employer. Remove their employer admin role instead.';
  end if;
  return old;
end;
$$;

-- Not practically callable outside trigger context anyway (Postgres refuses
-- direct invocation of a `returns trigger` function), but every comparable
-- trigger function elsewhere in this codebase explicitly revokes the
-- default PUBLIC execute grant too (e.g. validate_experience_parent_type,
-- sync_subject_organization_from_parent) -- matching that here rather than
-- relying solely on the `returns trigger` restriction.
revoke all on function prevent_employer_admin_provider_removal() from public, anon, authenticated;

create trigger prevent_employer_admin_provider_removal_trigger
  before delete on organisation_members
  for each row execute procedure prevent_employer_admin_provider_removal();
