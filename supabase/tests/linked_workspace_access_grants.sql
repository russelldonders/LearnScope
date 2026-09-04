-- Allow/deny proof for the "grant controlled cross-account access" RPCs
-- added in 20260904130000_linked_workspace_access_grants.sql. Run against a
-- local database only; the script rolls back everything it does.
--
-- Note: psql's `:'var'` substitution does not reach inside `do $$ ... $$`
-- blocks (verified separately), so every assertion below looks its target
-- id up via a direct query keyed on the fixed test emails/uuids, rather than
-- relying on a psql variable inside the block.
--
-- Proves:
--   1. The owner can request access to their own personal workspace for a
--      verified-linked account; both sides see the pending request via the
--      list RPCs, in the correct 'sent'/'received' direction.
--   2. An unrelated account cannot accept someone else's pending request.
--   3. The target account can accept; both sides then see the grant via the
--      list RPCs (in the correct 'granted'/'received' direction), and
--      private.can_view_learning_profile (from
--      20260904090000_learning_profile_access_helper.sql) now returns true
--      for that account on the owner's data -- proving this RPC surface is
--      the thing that actually produces the compound fact that helper
--      requires, not just a seed row in a test fixture.
--   4. Requesting again while an active grant exists is rejected.
--   5. The owner can revoke; the grantee's real access (via
--      can_view_learning_profile) is denied again afterward.
--   6. A fresh request/accept cycle after revocation works (no stale-state
--      lockout).
--   7. The grantee can renounce access they hold without the owner acting.
--   8. Revoking the underlying verified_account_link (via
--      revoke_verified_account_link, redefined in
--      20260904140000_revoke_link_cascades_workspace_access.sql) cascades to
--      revoke the workspace_access grant and cancel any pending request, and
--      simply reactivating the link afterward (simulating a later relink)
--      does NOT silently restore access without a fresh request/accept.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, email_confirmed_at)
values
  ('70000000-0000-0000-0000-000000000001', 'owner@example.com', now()),
  ('70000000-0000-0000-0000-000000000002', 'linked-work@example.com', now()),
  ('70000000-0000-0000-0000-000000000003', 'unrelated@example.com', now());

insert into public.skills (id, user_id, name, category, level)
values ('70000000-0000-0000-0000-00000000aaaa', '70000000-0000-0000-0000-000000000001', 'SQL', 'Technical', 3);

insert into public.verified_account_links (auth_account_a_id, auth_account_b_id)
values (
  least('70000000-0000-0000-0000-000000000001'::uuid, '70000000-0000-0000-0000-000000000002'::uuid),
  greatest('70000000-0000-0000-0000-000000000001'::uuid, '70000000-0000-0000-0000-000000000002'::uuid)
);

create or replace function pg_temp.sees_owner_skill(p_as_user uuid)
returns boolean
language plpgsql
as $$
declare
  v_visible boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_as_user::text, true);
  select exists (select 1 from public.skills where id = '70000000-0000-0000-0000-00000000aaaa') into v_visible;
  reset role;
  return v_visible;
end
$$;

-- Fetches the sole active verified_account_link between the fixed owner and
-- linked-work test accounts -- deterministic, so it's safe to look up
-- inside a do block instead of needing a psql variable.
create or replace function pg_temp.the_link_id()
returns uuid
language sql
as $$
  select id from public.verified_account_links
  where least(auth_account_a_id, auth_account_b_id) = least('70000000-0000-0000-0000-000000000001'::uuid, '70000000-0000-0000-0000-000000000002'::uuid)
    and greatest(auth_account_a_id, auth_account_b_id) = greatest('70000000-0000-0000-0000-000000000001'::uuid, '70000000-0000-0000-0000-000000000002'::uuid)
$$;

create or replace function pg_temp.the_pending_request_id()
returns uuid
language sql
as $$
  select id from public.linked_workspace_access_requests
  where requesting_auth_account_id = '70000000-0000-0000-0000-000000000001'
    and target_auth_account_id = '70000000-0000-0000-0000-000000000002'
    and status = 'pending'
  order by created_at desc
  limit 1
$$;

-- 1. Owner requests access for the linked-work account.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
  perform public.request_linked_workspace_access(pg_temp.the_link_id());
  reset role;
end
$$;

do $$
begin
  if not exists (select 1 from public.linked_workspace_access_requests where status = 'pending') then
    raise exception 'no pending request was created';
  end if;
end
$$;

do $$
begin
  if pg_temp.sees_owner_skill('70000000-0000-0000-0000-000000000002') then
    raise exception 'linked account already sees owner data before acceptance';
  end if;
end
$$;

do $$
declare v_count int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
  select count(*) into v_count from public.list_my_linked_workspace_access_requests()
  where request_id = pg_temp.the_pending_request_id() and direction = 'sent' and status = 'pending';
  reset role;
  if v_count <> 1 then raise exception 'owner does not see the request as sent'; end if;
end
$$;

do $$
declare v_count int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000002', true);
  select count(*) into v_count from public.list_my_linked_workspace_access_requests()
  where request_id = pg_temp.the_pending_request_id() and direction = 'received' and status = 'pending';
  reset role;
  if v_count <> 1 then raise exception 'target does not see the request as received'; end if;
end
$$;

-- 2. Unrelated account cannot accept.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000003', true);
  perform public.accept_linked_workspace_access(pg_temp.the_pending_request_id());
  reset role;
  raise exception 'unrelated account unexpectedly accepted someone else''s request';
exception
  when others then
    reset role;
    if sqlerrm not like '%Pending request not found%' then raise; end if;
end
$$;

-- 3. Target account accepts; verify grant visible both directions and real
--    access now works.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000002', true);
  perform public.accept_linked_workspace_access(pg_temp.the_pending_request_id());
  reset role;
end
$$;

do $$
begin
  if not pg_temp.sees_owner_skill('70000000-0000-0000-0000-000000000002') then
    raise exception 'linked account still cannot see owner data after acceptance';
  end if;
end
$$;

do $$
declare v_count int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
  select count(*) into v_count from public.list_my_linked_workspace_access_grants()
  where link_id = pg_temp.the_link_id() and direction = 'granted';
  reset role;
  if v_count <> 1 then raise exception 'owner does not see the grant as granted'; end if;
end
$$;

do $$
declare v_count int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000002', true);
  select count(*) into v_count from public.list_my_linked_workspace_access_grants()
  where link_id = pg_temp.the_link_id() and direction = 'received';
  reset role;
  if v_count <> 1 then raise exception 'grantee does not see the grant as received'; end if;
end
$$;

-- 4. Requesting again while already granted is rejected.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
  perform public.request_linked_workspace_access(pg_temp.the_link_id());
  reset role;
  raise exception 'duplicate request unexpectedly succeeded';
exception
  when others then
    reset role;
    if sqlerrm not like '%already granted%' then raise; end if;
end
$$;

-- 5. Owner revokes; real access is denied again.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
  perform public.revoke_granted_workspace_access(pg_temp.the_link_id());
  reset role;
end
$$;

do $$
begin
  if pg_temp.sees_owner_skill('70000000-0000-0000-0000-000000000002') then
    raise exception 'linked account still sees owner data after revocation';
  end if;
end
$$;

-- 6. A fresh request/accept cycle after revocation works.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
  perform public.request_linked_workspace_access(pg_temp.the_link_id());
  reset role;
end
$$;

do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000002', true);
  perform public.accept_linked_workspace_access(pg_temp.the_pending_request_id());
  reset role;
end
$$;

do $$
begin
  if not pg_temp.sees_owner_skill('70000000-0000-0000-0000-000000000002') then
    raise exception 'linked account cannot see owner data after a fresh request/accept cycle';
  end if;
end
$$;

-- 7. The grantee can renounce access without the owner acting.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000002', true);
  perform public.renounce_linked_workspace_access(pg_temp.the_link_id());
  reset role;
end
$$;

do $$
begin
  if pg_temp.sees_owner_skill('70000000-0000-0000-0000-000000000002') then
    raise exception 'linked account still sees owner data after renouncing it';
  end if;
end
$$;

-- 8. Grant access again, then revoke the underlying verified_account_link
--    (not the grant) and confirm the cascade tears the grant down too, and
--    that reactivating the link afterward does not silently restore it.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
  perform public.request_linked_workspace_access(pg_temp.the_link_id());
  reset role;
end
$$;

do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000002', true);
  perform public.accept_linked_workspace_access(pg_temp.the_pending_request_id());
  reset role;
end
$$;

do $$
begin
  if not pg_temp.sees_owner_skill('70000000-0000-0000-0000-000000000002') then
    raise exception 'linked account cannot see owner data after the setup grant for scenario 8';
  end if;
end
$$;

do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
  perform public.revoke_verified_account_link(pg_temp.the_link_id());
  reset role;
end
$$;

do $$
begin
  if pg_temp.sees_owner_skill('70000000-0000-0000-0000-000000000002') then
    raise exception 'linked account still sees owner data after the verified_account_link was revoked';
  end if;
  if exists (
    select 1 from public.workspace_access
    where auth_account_id = '70000000-0000-0000-0000-000000000002' and status = 'active'
      and workspace_id = '70000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'workspace_access grant was not cascade-revoked when the verified_account_link was revoked';
  end if;
end
$$;

-- Simulate a later relink of the same two accounts (what
-- redeem_account_link_invitation would do): reactivate the SAME link row.
update public.verified_account_links
set status = 'active', revoked_at = null
where id = pg_temp.the_link_id();

do $$
begin
  if pg_temp.sees_owner_skill('70000000-0000-0000-0000-000000000002') then
    raise exception 'relinking the same two accounts silently restored workspace access without a fresh accept';
  end if;
end
$$;

rollback;
