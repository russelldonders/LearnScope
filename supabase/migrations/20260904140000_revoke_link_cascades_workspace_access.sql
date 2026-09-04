-- Security/consent fix found by review of
-- 20260904130000_linked_workspace_access_grants.sql: revoke_verified_
-- account_link (20260903190000_verified_account_links.sql, already deployed
-- and not edited here) only flipped verified_account_links.status. It never
-- touched any workspace_access row created between the two accounts, and
-- redeem_account_link_invitation reactivates the SAME link row (same id) on
-- conflict when the same two accounts re-verify later. So: A grants B full
-- profile view access -> A revokes the link (LinkedAccountsList's own copy
-- explicitly reassures this only removes the verified connection) -> access
-- is correctly denied while the link is inactive (private.
-- can_view_learning_profile re-checks both facts live) -> but if the same
-- two accounts are ever re-verified later, the dangling, never-revoked
-- workspace_access row goes live again instantly, with no new
-- request_linked_workspace_access/accept_linked_workspace_access cycle. That
-- silently defeats this migration's own design goal that the receiving
-- account "must explicitly accept" -- and CLAUDE.md's "don't silently
-- infer, link, publish, share or materially update important learner
-- information".
--
-- Fix: redefine revoke_verified_account_link (new migration, not an edit to
-- the original) to also cascade-revoke any active workspace_access granted
-- between exactly these two accounts (in either direction) and cancel any
-- pending linked_workspace_access_requests between them, so a later relink
-- always requires a fresh request and a fresh accept. This never touches
-- either account's people/learning_profiles/history/personal recovery
-- login -- only the workspace_access and request rows tied to this specific
-- link.

create or replace function public.revoke_verified_account_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.verified_account_links;
  v_workspace_a uuid;
  v_workspace_b uuid;
begin
  update public.verified_account_links link
  set status = 'revoked', revoked_at = now()
  where link.id = p_link_id
    and link.status = 'active'
    and exists (
      select 1 from public.person_auth_accounts paa
      where paa.auth_user_id = auth.uid()
        and paa.status = 'active'
        and paa.id in (link.auth_account_a_id, link.auth_account_b_id)
    )
  returning * into v_link;
  if v_link.id is null then raise exception 'Active verified account link not found'; end if;

  select w.id into v_workspace_a
  from public.workspaces w
  join public.person_auth_accounts paa
    on paa.id = v_link.auth_account_a_id and paa.account_type = 'personal'
  where w.workspace_type = 'personal' and w.owner_person_id = paa.person_id;

  select w.id into v_workspace_b
  from public.workspaces w
  join public.person_auth_accounts paa
    on paa.id = v_link.auth_account_b_id and paa.account_type = 'personal'
  where w.workspace_type = 'personal' and w.owner_person_id = paa.person_id;

  update public.workspace_access
  set status = 'revoked', revoked_at = now()
  where status = 'active'
    and (
      (workspace_id = v_workspace_a and auth_account_id = v_link.auth_account_b_id)
      or (workspace_id = v_workspace_b and auth_account_id = v_link.auth_account_a_id)
    );

  update public.linked_workspace_access_requests
  set status = 'cancelled', decided_at = now()
  where status = 'pending' and verified_account_link_id = v_link.id;
end
$$;
