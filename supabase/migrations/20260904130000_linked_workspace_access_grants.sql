-- "Grant controlled cross-account access" phase from docs/account-
-- portability.md, now that the read-access model
-- (private.can_view_learning_profile) it depends on exists and has been
-- proven for skills/courses/experience and their dependents. This is the
-- first RPC surface that actually creates a workspace_access row for a
-- linked account -- everything before this migration only read state that
-- had to be seeded directly in SQL tests.
--
-- Deliberately a two-step request/accept flow, not a unilateral grant, to
-- match the mutual-consent pattern already established for account linking
-- (redeem_account_link_invitation) and transfer plans (both accounts must
-- approve the same version hash): even though a verified_account_link
-- proves the two auth accounts belong to the same person, the *receiving*
-- account (e.g. a monitored work SSO login) may not want its owner's
-- personal data made visible through it, so it must explicitly accept.
--
-- Invariants enforced by every function below (never by the caller):
--   - An owner may only request/revoke access to THEIR OWN personal
--     workspace, derived from auth.uid(), never taken as a parameter.
--   - A request may only be created between two accounts with an ACTIVE
--     verified_account_links row; re-checked again at accept time in case
--     the link was revoked in between (defense in depth, same as
--     private.can_view_learning_profile's own compound check).
--   - Only the actual target account can accept/decline a request; only the
--     actual requesting account can cancel one.
--   - Granted access always uses access_role = 'owner' -- the same role
--     private.can_view_learning_profile requires -- so accepting a request
--     is the only way today for that helper to ever return true for a
--     second, distinct auth account.
--   - Revoking (by the owner) or renouncing (by the grantee) never touches
--     the underlying verified_account_links row, either account's people/
--     learning_profiles/history, or the personal recovery login.

create table public.linked_workspace_access_requests (
  id uuid primary key default gen_random_uuid(),
  verified_account_link_id uuid not null references public.verified_account_links(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requesting_auth_account_id uuid not null references public.person_auth_accounts(id) on delete cascade,
  target_auth_account_id uuid not null references public.person_auth_accounts(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (requesting_auth_account_id <> target_auth_account_id),
  check (
    (status = 'pending' and decided_at is null)
    or (status <> 'pending' and decided_at is not null)
  )
);

create index linked_workspace_access_requests_requester_idx
  on public.linked_workspace_access_requests (requesting_auth_account_id, status, created_at desc);
create index linked_workspace_access_requests_target_idx
  on public.linked_workspace_access_requests (target_auth_account_id, status, created_at desc);
-- At most one pending request per (workspace, target) pair -- a fresh
-- request first cancels any prior pending one for the same pair, but this
-- is the hard guarantee, not just an application-level convention.
create unique index linked_workspace_access_requests_pending_unique_idx
  on public.linked_workspace_access_requests (workspace_id, target_auth_account_id)
  where status = 'pending';

alter table public.linked_workspace_access_requests enable row level security;
grant select on public.linked_workspace_access_requests to authenticated;

create policy "Accounts can view requests they sent or received"
  on public.linked_workspace_access_requests for select
  to authenticated
  using (
    exists (
      select 1 from public.person_auth_accounts paa
      where paa.auth_user_id = (select auth.uid())
        and paa.status = 'active'
        and paa.id in (requesting_auth_account_id, target_auth_account_id)
    )
  );

-- Caller's own active personal workspace, or null if the caller has none
-- (organisation-only accounts, or an inactive/missing personal account).
create or replace function private.my_personal_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select w.id
  from public.workspaces w
  join public.person_auth_accounts paa
    on paa.person_id = w.owner_person_id
    and paa.account_type = 'personal'
    and paa.status = 'active'
    and paa.auth_user_id = auth.uid()
  where w.workspace_type = 'personal'
    and w.status = 'active'
  limit 1
$$;

revoke all on function private.my_personal_workspace_id() from public, anon, authenticated;

create or replace function public.request_linked_workspace_access(p_link_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requester public.person_auth_accounts;
  v_link public.verified_account_links;
  v_target_id uuid;
  v_workspace_id uuid;
  v_request_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_requester
  from public.person_auth_accounts
  where auth_user_id = auth.uid() and status = 'active';
  if v_requester.id is null then raise exception 'Active authentication account not found'; end if;

  select * into v_link
  from public.verified_account_links
  where id = p_link_id and status = 'active'
    and v_requester.id in (auth_account_a_id, auth_account_b_id);
  if v_link.id is null then raise exception 'Active verified account link not found'; end if;

  v_target_id := case when v_link.auth_account_a_id = v_requester.id
    then v_link.auth_account_b_id else v_link.auth_account_a_id end;

  v_workspace_id := private.my_personal_workspace_id();
  if v_workspace_id is null then raise exception 'You have no personal workspace to share'; end if;

  if exists (
    select 1 from public.workspace_access
    where workspace_id = v_workspace_id and auth_account_id = v_target_id
      and access_role = 'owner' and status = 'active'
  ) then
    raise exception 'Workspace access is already granted to this account';
  end if;

  update public.linked_workspace_access_requests
  set status = 'cancelled', decided_at = now()
  where workspace_id = v_workspace_id and target_auth_account_id = v_target_id and status = 'pending';

  insert into public.linked_workspace_access_requests (
    verified_account_link_id, workspace_id, requesting_auth_account_id, target_auth_account_id
  ) values (
    v_link.id, v_workspace_id, v_requester.id, v_target_id
  ) returning id into v_request_id;

  return v_request_id;
end
$$;

create or replace function public.accept_linked_workspace_access(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.person_auth_accounts;
  v_request public.linked_workspace_access_requests;
  v_link_active boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_account
  from public.person_auth_accounts
  where auth_user_id = auth.uid() and status = 'active';
  if v_account.id is null then raise exception 'Active authentication account not found'; end if;

  select * into v_request
  from public.linked_workspace_access_requests
  where id = p_request_id and target_auth_account_id = v_account.id and status = 'pending'
  for update;
  if v_request.id is null then raise exception 'Pending request not found' ; end if;

  select exists (
    select 1 from public.verified_account_links
    where id = v_request.verified_account_link_id and status = 'active'
  ) into v_link_active;
  if not v_link_active then raise exception 'The verified account link for this request is no longer active'; end if;

  -- granted_by records the account that OFFERED the access (the requester,
  -- i.e. the workspace's own owner), not the account accepting it -- the
  -- accepter is already target_auth_account_id/auth_account_id below.
  insert into public.workspace_access (workspace_id, auth_account_id, access_role, granted_by)
  select v_request.workspace_id, v_request.target_auth_account_id, 'owner', paa.auth_user_id
  from public.person_auth_accounts paa
  where paa.id = v_request.requesting_auth_account_id
  on conflict (workspace_id, auth_account_id, access_role) do update
    set status = 'active', revoked_at = null, granted_at = now(), granted_by = excluded.granted_by;

  update public.linked_workspace_access_requests
  set status = 'accepted', decided_at = now()
  where id = v_request.id;
end
$$;

create or replace function public.decline_linked_workspace_access(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.linked_workspace_access_requests req
  set status = 'declined', decided_at = now()
  where req.id = p_request_id and req.status = 'pending'
    and exists (
      select 1 from public.person_auth_accounts paa
      where paa.auth_user_id = auth.uid() and paa.status = 'active'
        and paa.id = req.target_auth_account_id
    );
  if not found then raise exception 'Pending request not found'; end if;
end
$$;

create or replace function public.cancel_linked_workspace_access_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.linked_workspace_access_requests req
  set status = 'cancelled', decided_at = now()
  where req.id = p_request_id and req.status = 'pending'
    and exists (
      select 1 from public.person_auth_accounts paa
      where paa.auth_user_id = auth.uid() and paa.status = 'active'
        and paa.id = req.requesting_auth_account_id
    );
  if not found then raise exception 'Pending request not found'; end if;
end
$$;

-- Owner-side revoke: tears down access they previously granted to the
-- other party of a specific link, scoped to the caller's own workspace.
create or replace function public.revoke_granted_workspace_access(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.person_auth_accounts;
  v_link public.verified_account_links;
  v_target_id uuid;
  v_workspace_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_owner
  from public.person_auth_accounts
  where auth_user_id = auth.uid() and status = 'active';
  if v_owner.id is null then raise exception 'Active authentication account not found'; end if;

  select * into v_link
  from public.verified_account_links
  where id = p_link_id and v_owner.id in (auth_account_a_id, auth_account_b_id);
  if v_link.id is null then raise exception 'Verified account link not found'; end if;

  v_target_id := case when v_link.auth_account_a_id = v_owner.id
    then v_link.auth_account_b_id else v_link.auth_account_a_id end;

  v_workspace_id := private.my_personal_workspace_id();
  if v_workspace_id is null then raise exception 'You have no personal workspace'; end if;

  update public.workspace_access
  set status = 'revoked', revoked_at = now()
  where workspace_id = v_workspace_id and auth_account_id = v_target_id
    and access_role = 'owner' and status = 'active';
  if not found then raise exception 'Active workspace access grant not found'; end if;
end
$$;

-- Grantee-side renounce: the account that received access gives it up
-- voluntarily, without needing the owner to act.
create or replace function public.renounce_linked_workspace_access(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grantee public.person_auth_accounts;
  v_link public.verified_account_links;
  v_owner_account_id uuid;
  v_workspace_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_grantee
  from public.person_auth_accounts
  where auth_user_id = auth.uid() and status = 'active';
  if v_grantee.id is null then raise exception 'Active authentication account not found'; end if;

  select * into v_link
  from public.verified_account_links
  where id = p_link_id and v_grantee.id in (auth_account_a_id, auth_account_b_id);
  if v_link.id is null then raise exception 'Verified account link not found'; end if;

  v_owner_account_id := case when v_link.auth_account_a_id = v_grantee.id
    then v_link.auth_account_b_id else v_link.auth_account_a_id end;

  select w.id into v_workspace_id
  from public.workspaces w
  join public.person_auth_accounts owner_paa
    on owner_paa.person_id = w.owner_person_id
    and owner_paa.id = v_owner_account_id
  where w.workspace_type = 'personal';
  if v_workspace_id is null then raise exception 'Workspace not found'; end if;

  update public.workspace_access
  set status = 'revoked', revoked_at = now()
  where workspace_id = v_workspace_id and auth_account_id = v_grantee.id
    and access_role = 'owner' and status = 'active';
  if not found then raise exception 'Active workspace access grant not found'; end if;
end
$$;

create or replace function public.list_my_linked_workspace_access_requests()
returns table (
  request_id uuid,
  link_id uuid,
  other_email text,
  direction text,
  status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select id from public.person_auth_accounts
    where auth_user_id = auth.uid() and status = 'active'
  )
  select
    req.id,
    req.verified_account_link_id,
    other_user.email,
    case when req.requesting_auth_account_id = mine.id then 'sent' else 'received' end,
    req.status,
    req.created_at
  from public.linked_workspace_access_requests req
  join mine on mine.id in (req.requesting_auth_account_id, req.target_auth_account_id)
  join public.person_auth_accounts other_account
    on other_account.id = case
      when req.requesting_auth_account_id = mine.id then req.target_auth_account_id
      else req.requesting_auth_account_id
    end
  join auth.users other_user on other_user.id = other_account.auth_user_id
  where req.status = 'pending'
  order by req.created_at desc
$$;

create or replace function public.list_my_linked_workspace_access_grants()
returns table (
  link_id uuid,
  other_email text,
  direction text,
  granted_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select id, person_id from public.person_auth_accounts
    where auth_user_id = auth.uid() and status = 'active'
  ),
  my_workspace as (
    select w.id from public.workspaces w, mine
    where w.workspace_type = 'personal' and w.status = 'active' and w.owner_person_id = mine.person_id
  ),
  linked_others as (
    select
      link.id as link_id,
      case when link.auth_account_a_id = mine.id then link.auth_account_b_id else link.auth_account_a_id end as other_account_id
    from public.verified_account_links link
    join mine on mine.id in (link.auth_account_a_id, link.auth_account_b_id)
    where link.status = 'active'
  )
  -- Access I granted: an active owner-role row on MY workspace for the other account.
  select lo.link_id, u.email, 'granted', wa.granted_at
  from linked_others lo
  join my_workspace mw on true
  join public.workspace_access wa
    on wa.workspace_id = mw.id and wa.auth_account_id = lo.other_account_id
    and wa.access_role = 'owner' and wa.status = 'active'
  join public.person_auth_accounts other_paa on other_paa.id = lo.other_account_id
  join auth.users u on u.id = other_paa.auth_user_id

  union all

  -- Access I received: an active owner-role row on the OTHER account's workspace for me.
  select lo.link_id, u.email, 'received', wa.granted_at
  from mine
  join linked_others lo on true
  join public.person_auth_accounts other_paa on other_paa.id = lo.other_account_id
  join public.workspaces other_ws
    on other_ws.workspace_type = 'personal' and other_ws.status = 'active' and other_ws.owner_person_id = other_paa.person_id
  join public.workspace_access wa
    on wa.workspace_id = other_ws.id and wa.auth_account_id = mine.id
    and wa.access_role = 'owner' and wa.status = 'active'
  join auth.users u on u.id = other_paa.auth_user_id
$$;

revoke all on function
  public.request_linked_workspace_access(uuid),
  public.accept_linked_workspace_access(uuid),
  public.decline_linked_workspace_access(uuid),
  public.cancel_linked_workspace_access_request(uuid),
  public.revoke_granted_workspace_access(uuid),
  public.renounce_linked_workspace_access(uuid),
  public.list_my_linked_workspace_access_requests(),
  public.list_my_linked_workspace_access_grants()
from public, anon;
grant execute on function
  public.request_linked_workspace_access(uuid),
  public.accept_linked_workspace_access(uuid),
  public.decline_linked_workspace_access(uuid),
  public.cancel_linked_workspace_access_request(uuid),
  public.revoke_granted_workspace_access(uuid),
  public.renounce_linked_workspace_access(uuid),
  public.list_my_linked_workspace_access_requests(),
  public.list_my_linked_workspace_access_grants()
to authenticated;
