-- Distinguishes an account an employer provisioned (using the person's work
-- details) from one the learner set up themselves, using the existing but
-- previously-unwired person_auth_accounts.account_type/employer_id columns
-- from the person/workspace foundation (20260903110000) -- 'work_managed'
-- already exists there, nothing has ever set it until now.
--
-- account_type/employer_id stay an immutable record of how the account
-- ORIGINATED (one employer, set once at provisioning time) -- they are
-- deliberately NOT a live "who currently has access" list; that's already
-- employer_members' own job (many rows per user_id, updated as memberships
-- change). The two are read together on the learner's own profile: origin
-- for "this account was created by X", employer_members for "currently
-- linked to X, Y" in case that differs from the origin employer over time.
--
-- personal_ownership_claimed_at is a separate, additive fact: once the
-- learner completes the "Add personal ownership" flow (new personal email +
-- new password -- see claim_personal_account_ownership below), this is
-- stamped, but account_type/employer_id are left as-is so the account's
-- work origin stays on record even after the learner has secured
-- independent access to it. Historical-accuracy pattern, same as never
-- overwriting created_at elsewhere in this schema.
alter table public.person_auth_accounts
  add column personal_ownership_claimed_at timestamptz;

-- Best-effort backfill for accounts created before this migration existed:
-- there's no reliable way to tell, after the fact, whether a given account
-- was employer-provisioned or self-signed-up and separately joined an
-- employer, so this approximates it as "currently an active member of at
-- least one employer" -- picking that membership's earliest join as the
-- nominal origin employer when there's more than one. Going forward,
-- addEmployerMember (api/admin/actions.js) sets this precisely, only for
-- accounts it actually creates via invite.
with earliest_active_membership as (
  select distinct on (em.user_id) em.user_id, em.employer_id
  from public.employer_members em
  where em.status = 'active'
  order by em.user_id, em.created_at asc
)
update public.person_auth_accounts paa
set account_type = 'work_managed',
    employer_id = eam.employer_id
from earliest_active_membership eam
where paa.auth_user_id = eam.user_id
  and paa.account_type = 'personal';

-- Self-service: the signed-in learner marks their own account as having
-- had personal ownership claimed. Doesn't itself change email/password --
-- the client completes those first (supabase.auth.updateUser, already
-- self-service) and calls this once both succeed. No condition beyond
-- "this is my own account" is enforced server-side; there's no reliable way
-- to verify a "personal" vs "work" email from the address alone, so this
-- trusts the guided client flow the same way the rest of this learner's own
-- profile editing already does.
create or replace function public.claim_personal_account_ownership()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.person_auth_accounts
  set personal_ownership_claimed_at = now(), updated_at = now()
  where auth_user_id = auth.uid();
end
$$;

revoke all on function public.claim_personal_account_ownership() from public, anon;
grant execute on function public.claim_personal_account_ownership() to authenticated;

-- A single read for the learner's own profile page. Deliberately an RPC
-- rather than a client-side embed of person_auth_accounts.employer_id ->
-- employers(name): employers' own RLS only allows a *current* member to
-- read its name (is_employer_member), so a plain embed would silently
-- return null for the origin employer's name once the learner has left it
-- -- exactly the case where "this account was created by X" matters most.
-- This security definer function reads across that boundary just for the
-- caller's own origin employer, nothing else.
create or replace function public.get_my_account_ownership()
returns table (
  account_type text,
  origin_employer_name text,
  personal_ownership_claimed_at timestamptz,
  active_employer_names text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    paa.account_type,
    oe.name as origin_employer_name,
    paa.personal_ownership_claimed_at,
    coalesce(
      (select array_agg(distinct ae.name order by ae.name)
       from public.employer_members em
       join public.employers ae on ae.id = em.employer_id
       where em.user_id = auth.uid() and em.status = 'active'),
      '{}'::text[]
    ) as active_employer_names
  from public.person_auth_accounts paa
  left join public.employers oe on oe.id = paa.employer_id
  where paa.auth_user_id = auth.uid();
$$;

revoke all on function public.get_my_account_ownership() from public, anon;
grant execute on function public.get_my_account_ownership() to authenticated;
