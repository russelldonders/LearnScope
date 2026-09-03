-- Proof-of-control foundation for linking two distinct authentication accounts.
-- This is intentionally separate from Supabase Auth identity linking because
-- SAML SSO identities cannot participate in Supabase's manual linking flow.
-- Redeeming a link verifies that both accounts belong to the same person, but
-- does not merge people, move learner records, or grant workspace access.

create table public.account_link_invitations (
  id uuid primary key default gen_random_uuid(),
  requesting_auth_account_id uuid not null references public.person_auth_accounts(id) on delete cascade,
  target_email text not null,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  accepted_by_auth_account_id uuid references public.person_auth_accounts(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check (target_email = lower(trim(target_email))),
  check (expires_at > created_at),
  check (
    (status = 'accepted' and accepted_by_auth_account_id is not null and accepted_at is not null)
    or (status <> 'accepted' and accepted_by_auth_account_id is null and accepted_at is null)
  )
);

create index account_link_invitations_requester_idx
  on public.account_link_invitations (requesting_auth_account_id, status, created_at desc);
create index account_link_invitations_pending_expiry_idx
  on public.account_link_invitations (expires_at)
  where status = 'pending';

create table public.verified_account_links (
  id uuid primary key default gen_random_uuid(),
  auth_account_a_id uuid not null references public.person_auth_accounts(id) on delete cascade,
  auth_account_b_id uuid not null references public.person_auth_accounts(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'revoked')),
  verified_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_from_invitation_id uuid references public.account_link_invitations(id) on delete set null,
  check (auth_account_a_id < auth_account_b_id),
  check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  ),
  unique (auth_account_a_id, auth_account_b_id)
);

create index verified_account_links_a_idx
  on public.verified_account_links (auth_account_a_id, status);
create index verified_account_links_b_idx
  on public.verified_account_links (auth_account_b_id, status);

alter table public.account_link_invitations enable row level security;
alter table public.verified_account_links enable row level security;

grant select on public.account_link_invitations, public.verified_account_links to authenticated;

create policy "Accounts can view link invitations they created or accepted"
  on public.account_link_invitations for select
  to authenticated
  using (
    exists (
      select 1 from public.person_auth_accounts paa
      where paa.auth_user_id = (select auth.uid())
        and paa.status = 'active'
        and paa.id in (requesting_auth_account_id, accepted_by_auth_account_id)
    )
  );

create policy "Accounts can view their verified links"
  on public.verified_account_links for select
  to authenticated
  using (
    exists (
      select 1 from public.person_auth_accounts paa
      where paa.auth_user_id = (select auth.uid())
        and paa.status = 'active'
        and paa.id in (auth_account_a_id, auth_account_b_id)
    )
  );

create or replace function public.create_account_link_invitation(p_target_email text)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requester public.person_auth_accounts;
  v_email text := lower(trim(p_target_email));
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_invitation public.account_link_invitations;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address';
  end if;

  select * into v_requester
  from public.person_auth_accounts
  where auth_user_id = auth.uid() and status = 'active';
  if v_requester.id is null then raise exception 'Active authentication account not found'; end if;

  if exists (select 1 from auth.users where id = auth.uid() and lower(email) = v_email) then
    raise exception 'Use a different account email';
  end if;

  update public.account_link_invitations
  set status = 'cancelled'
  where requesting_auth_account_id = v_requester.id and status = 'pending';

  insert into public.account_link_invitations (
    requesting_auth_account_id, target_email, token_hash, expires_at
  ) values (
    v_requester.id, v_email, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '30 minutes'
  ) returning * into v_invitation;

  return query select v_invitation.id, v_token, v_invitation.expires_at;
end
$$;

create or replace function public.redeem_account_link_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redeemer public.person_auth_accounts;
  v_invitation public.account_link_invitations;
  v_email text;
  v_a uuid;
  v_b uuid;
  v_link_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_redeemer
  from public.person_auth_accounts
  where auth_user_id = auth.uid() and status = 'active';
  if v_redeemer.id is null then raise exception 'Active authentication account not found'; end if;

  select lower(email) into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then raise exception 'A verified email address is required'; end if;

  select * into v_invitation
  from public.account_link_invitations
  where token_hash = encode(extensions.digest(trim(p_token), 'sha256'), 'hex')
  for update;

  if v_invitation.id is null or v_invitation.status <> 'pending' then
    raise exception 'Link invitation is invalid or no longer available';
  end if;
  if v_invitation.expires_at <= now() then
    update public.account_link_invitations set status = 'expired' where id = v_invitation.id;
    raise exception 'Link invitation has expired';
  end if;
  if v_invitation.target_email <> v_email then
    raise exception 'Sign in with the invited email address';
  end if;
  if v_invitation.requesting_auth_account_id = v_redeemer.id then
    raise exception 'An account cannot link to itself';
  end if;

  v_a := least(v_invitation.requesting_auth_account_id, v_redeemer.id);
  v_b := greatest(v_invitation.requesting_auth_account_id, v_redeemer.id);

  insert into public.verified_account_links (
    auth_account_a_id, auth_account_b_id, created_from_invitation_id
  ) values (v_a, v_b, v_invitation.id)
  on conflict (auth_account_a_id, auth_account_b_id) do update
    set status = 'active', revoked_at = null, verified_at = now(),
        created_from_invitation_id = excluded.created_from_invitation_id
  returning id into v_link_id;

  update public.account_link_invitations
  set status = 'accepted', accepted_by_auth_account_id = v_redeemer.id, accepted_at = now()
  where id = v_invitation.id;

  return v_link_id;
end
$$;

create or replace function public.revoke_verified_account_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
    );
  if not found then raise exception 'Active verified account link not found'; end if;
end
$$;

create or replace function public.list_my_verified_account_links()
returns table (
  link_id uuid,
  other_email text,
  other_account_type text,
  direction text,
  status text,
  verified_at timestamptz
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
    link.id,
    other_user.email,
    other_account.account_type,
    case
      when invitation.requesting_auth_account_id = mine.id then 'sent'
      else 'received'
    end,
    link.status,
    link.verified_at
  from public.verified_account_links link
  join mine on mine.id in (link.auth_account_a_id, link.auth_account_b_id)
  join public.person_auth_accounts other_account
    on other_account.id = case
      when link.auth_account_a_id = mine.id then link.auth_account_b_id
      else link.auth_account_a_id
    end
  join auth.users other_user on other_user.id = other_account.auth_user_id
  left join public.account_link_invitations invitation on invitation.id = link.created_from_invitation_id
  order by link.verified_at desc
$$;

revoke all on function public.create_account_link_invitation(text),
  public.redeem_account_link_invitation(text), public.revoke_verified_account_link(uuid),
  public.list_my_verified_account_links()
from public, anon;
grant execute on function public.create_account_link_invitation(text),
  public.redeem_account_link_invitation(text), public.revoke_verified_account_link(uuid),
  public.list_my_verified_account_links()
to authenticated;
