-- First domain-by-domain step of the additive learning-profile ownership
-- transition described in docs/claude-account-portability-handoff.md and
-- docs/account-portability.md. This does not change any existing ownership
-- column or replace any existing RLS policy: it adds a narrowly scoped,
-- read-only access path so a verified-linked authentication account can be
-- explicitly granted visibility into another person's personal learning
-- profile through workspace_access, without weakening or altering the
-- existing auth.uid() = user_id behaviour for the profile's own owner.
--
-- 20260903210000_profile_transfer_plans.sql remains deployed and immutable;
-- this is a new, separate migration.
--
-- Access requires two independent, explicit, revocable facts to both be true
-- for the *other* auth account (never for the profile owner's own account,
-- which keeps its unconditional access from the original 0001/0002 policies):
--   1. An active workspace_access row, with access_role = 'owner', on the
--      profile's active personal workspace.
--   2. An active verified_account_link to the workspace owner's own personal
--      authentication account.
-- Revoking either one independently denies access (defense in depth), and
-- neither fact is inferred from names, email domains, or employer
-- membership. The access_role/workspace-status/profile-status checks are
-- currently redundant with today's only code path (the bootstrap trigger
-- only ever creates 'owner' rows on active personal workspaces), but are
-- included now -- matching the same restriction already used by
-- private.can_manage_manager_workspace in
-- 20260903130000_manager_team_foundation.sql -- so a future grant RPC or a
-- workspace/profile suspension feature can't silently widen this helper's
-- meaning. There is still no mechanism here that grants workspace_access to
-- a linked account -- that explicit, mutually consented grant is the "Grant
-- controlled cross-account access" phase in docs/account-portability.md and
-- is deliberately not implemented yet.
--
-- SECURITY DEFINER is required (not merely convenient): the existing
-- "Personal accounts can view their personal learning profile" and workspace
-- policies scope learning_profiles/workspaces to the caller's *own* person,
-- so a linked account's caller-context query could never see another
-- person's workspace row to evaluate access against. This function is the
-- narrow, intentional bypass for exactly that cross-person check.

-- A person can have at most one active personal person_auth_accounts row:
-- enforced so private.personal_workspace_owner_account's `limit 1` reflects
-- a real invariant rather than an unenforced assumption.
create unique index person_auth_accounts_active_personal_unique_idx
  on person_auth_accounts (person_id)
  where account_type = 'personal' and status = 'active';

create or replace function private.personal_workspace_owner_account(p_workspace_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select paa.id
  from public.workspaces w
  join public.person_auth_accounts paa
    on paa.person_id = w.owner_person_id
    and paa.account_type = 'personal'
    and paa.status = 'active'
  where w.id = p_workspace_id
    and w.workspace_type = 'personal'
    and w.status = 'active'
  limit 1
$$;

revoke all on function private.personal_workspace_owner_account(uuid) from public, anon, authenticated;

-- p_legacy_user_id is the existing auth.users.id used throughout the legacy
-- learner schema (profiles.id, skills.user_id, and equivalents). Returns
-- whether the currently authenticated auth account may read that profile's
-- data: either because it *is* the profile's own owner, or because it holds
-- both an active workspace_access grant and an active verified_account_link
-- to the owner's personal auth account.
create or replace function private.can_view_learning_profile(p_legacy_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.learning_profiles lp
    join public.workspaces w
      on w.personal_profile_id = lp.id
      and w.workspace_type = 'personal'
      and w.status = 'active'
    join public.workspace_access wa
      on wa.workspace_id = w.id
      and wa.status = 'active'
      and wa.access_role = 'owner'
    join public.person_auth_accounts paa
      on paa.id = wa.auth_account_id
      and paa.status = 'active'
      and paa.auth_user_id = auth.uid()
    where lp.legacy_user_id = p_legacy_user_id
      and lp.status = 'active'
      and (
        paa.id = private.personal_workspace_owner_account(w.id)
        or exists (
          select 1
          from public.verified_account_links link
          where link.status = 'active'
            and (
              (link.auth_account_a_id = paa.id
                and link.auth_account_b_id = private.personal_workspace_owner_account(w.id))
              or (link.auth_account_b_id = paa.id
                and link.auth_account_a_id = private.personal_workspace_owner_account(w.id))
            )
        )
      )
  )
$$;

revoke all on function private.can_view_learning_profile(uuid) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.can_view_learning_profile(uuid) to authenticated;

-- First domain root table converted as the initial, reviewable increment:
-- skills. It keeps its existing "for all" owner policy completely unchanged
-- and gains a new, additive, SELECT-only policy. profiles is deliberately
-- NOT converted here: it already carries a pre-existing, unrelated
-- "Authenticated users can view profile names" policy with `using (true)`,
-- so any narrower additive policy on it would be a no-op (permissive
-- policies only add access; they cannot narrow an already-unconditional
-- one). That existing open-read policy is outside this migration's scope.
-- Remaining learner domains (courses, experience, actions, evidence,
-- connections, xAPI, and skills' own dependent tables) are unconverted and
-- still rely solely on auth.uid() = user_id, per the handoff's "convert
-- domain by domain" rule.
create policy "Linked accounts can view accessible skills"
  on skills for select
  to authenticated
  using (private.can_view_learning_profile(user_id));
