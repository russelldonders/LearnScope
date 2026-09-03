-- Two-party consent gate for comparing separately owned learner profiles.
-- This migration is read-only with respect to learner data: it never moves,
-- merges, deletes, or reassigns any profile-owned record.

create table public.profile_transfer_previews (
  id uuid primary key default gen_random_uuid(),
  verified_account_link_id uuid not null references public.verified_account_links(id) on delete cascade,
  requested_by_auth_account_id uuid not null references public.person_auth_accounts(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'cancelled', 'expired')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  approved_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((status = 'approved') = (approved_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null))
);

create unique index profile_transfer_previews_open_link_idx
  on public.profile_transfer_previews (verified_account_link_id)
  where status in ('pending', 'approved');

create table public.profile_transfer_preview_approvals (
  preview_id uuid not null references public.profile_transfer_previews(id) on delete cascade,
  auth_account_id uuid not null references public.person_auth_accounts(id) on delete cascade,
  approved_at timestamptz not null default now(),
  primary key (preview_id, auth_account_id)
);

create index profile_transfer_preview_approvals_account_idx
  on public.profile_transfer_preview_approvals (auth_account_id, preview_id);

alter table public.profile_transfer_previews enable row level security;
alter table public.profile_transfer_preview_approvals enable row level security;
grant select on public.profile_transfer_previews, public.profile_transfer_preview_approvals to authenticated;

create policy "Linked accounts can view their transfer previews"
  on public.profile_transfer_previews for select to authenticated
  using (
    exists (
      select 1
      from public.verified_account_links link
      join public.person_auth_accounts account
        on account.id in (link.auth_account_a_id, link.auth_account_b_id)
      where link.id = profile_transfer_previews.verified_account_link_id
        and account.auth_user_id = (select auth.uid())
        and account.status = 'active'
    )
  );

create policy "Linked accounts can view preview approvals"
  on public.profile_transfer_preview_approvals for select to authenticated
  using (
    exists (
      select 1
      from public.profile_transfer_previews preview
      join public.verified_account_links link on link.id = preview.verified_account_link_id
      join public.person_auth_accounts account
        on account.id in (link.auth_account_a_id, link.auth_account_b_id)
      where preview.id = profile_transfer_preview_approvals.preview_id
        and account.auth_user_id = (select auth.uid())
        and account.status = 'active'
    )
  );

create or replace function private.current_link_account(p_link_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select account.id
  from public.verified_account_links link
  join public.person_auth_accounts account
    on account.id in (link.auth_account_a_id, link.auth_account_b_id)
  where link.id = p_link_id
    and link.status = 'active'
    and account.auth_user_id = auth.uid()
    and account.status = 'active'
$$;

revoke all on function private.current_link_account(uuid) from public, anon, authenticated;

create or replace function public.request_profile_transfer_preview(p_link_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := private.current_link_account(p_link_id);
  v_preview_id uuid;
begin
  if v_account_id is null then raise exception 'Active verified account link not found'; end if;

  update public.profile_transfer_previews
  set status = 'expired', approved_at = null, updated_at = now()
  where verified_account_link_id = p_link_id
    and status in ('pending', 'approved')
    and expires_at <= now();

  select id into v_preview_id
  from public.profile_transfer_previews
  where verified_account_link_id = p_link_id and status in ('pending', 'approved');

  if v_preview_id is null then
    insert into public.profile_transfer_previews (
      verified_account_link_id, requested_by_auth_account_id
    ) values (p_link_id, v_account_id)
    returning id into v_preview_id;
  end if;

  insert into public.profile_transfer_preview_approvals (preview_id, auth_account_id)
  values (v_preview_id, v_account_id)
  on conflict do nothing;
  return v_preview_id;
end
$$;

create or replace function public.approve_profile_transfer_preview(p_preview_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview public.profile_transfer_previews;
  v_account_id uuid;
begin
  select * into v_preview from public.profile_transfer_previews where id = p_preview_id for update;
  if v_preview.id is null or v_preview.status <> 'pending' then raise exception 'Pending preview not found'; end if;
  if v_preview.expires_at <= now() then
    update public.profile_transfer_previews set status = 'expired', updated_at = now() where id = p_preview_id;
    return;
  end if;

  v_account_id := private.current_link_account(v_preview.verified_account_link_id);
  if v_account_id is null then raise exception 'Active verified account link not found'; end if;
  insert into public.profile_transfer_preview_approvals (preview_id, auth_account_id)
  values (p_preview_id, v_account_id) on conflict do nothing;

  if (select count(*) from public.profile_transfer_preview_approvals where preview_id = p_preview_id) = 2 then
    update public.profile_transfer_previews
    set status = 'approved', approved_at = now(), updated_at = now()
    where id = p_preview_id;
  end if;
end
$$;

create or replace function public.cancel_profile_transfer_preview(p_preview_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profile_transfer_previews preview
  set status = 'cancelled', cancelled_at = now(), approved_at = null, updated_at = now()
  where preview.id = p_preview_id
    and preview.status in ('pending', 'approved')
    and private.current_link_account(preview.verified_account_link_id) is not null;
  if not found then raise exception 'Active preview not found'; end if;
end
$$;

create or replace function public.list_my_profile_transfer_previews()
returns table (
  preview_id uuid,
  link_id uuid,
  other_email text,
  status text,
  requested_by_me boolean,
  approved_by_me boolean,
  approval_count integer,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    preview.id,
    link.id,
    other_user.email,
    case when preview.status = 'pending' and preview.expires_at <= now() then 'expired' else preview.status end,
    preview.requested_by_auth_account_id = mine.id,
    exists (select 1 from public.profile_transfer_preview_approvals approval where approval.preview_id = preview.id and approval.auth_account_id = mine.id),
    (select count(*)::integer from public.profile_transfer_preview_approvals approval where approval.preview_id = preview.id),
    preview.expires_at
  from public.profile_transfer_previews preview
  join public.verified_account_links link on link.id = preview.verified_account_link_id
  join public.person_auth_accounts mine
    on mine.id in (link.auth_account_a_id, link.auth_account_b_id)
   and mine.auth_user_id = auth.uid() and mine.status = 'active'
  join public.person_auth_accounts other_account
    on other_account.id = case when link.auth_account_a_id = mine.id then link.auth_account_b_id else link.auth_account_a_id end
  join auth.users other_user on other_user.id = other_account.auth_user_id
  order by preview.created_at desc
$$;

create or replace function public.get_profile_transfer_comparison(p_preview_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_preview public.profile_transfer_previews;
  v_link public.verified_account_links;
  v_user_a uuid;
  v_user_b uuid;
begin
  select * into v_preview from public.profile_transfer_previews where id = p_preview_id;
  if v_preview.id is null or v_preview.status <> 'approved' or v_preview.expires_at <= now() then
    raise exception 'Approved transfer preview not found';
  end if;
  if private.current_link_account(v_preview.verified_account_link_id) is null then
    raise exception 'Active verified account link not found';
  end if;
  select * into v_link from public.verified_account_links where id = v_preview.verified_account_link_id;
  select auth_user_id into v_user_a from public.person_auth_accounts where id = v_link.auth_account_a_id;
  select auth_user_id into v_user_b from public.person_auth_accounts where id = v_link.auth_account_b_id;

  return jsonb_build_object(
    'profiles', jsonb_build_array(
      private.profile_transfer_summary(v_user_a),
      private.profile_transfer_summary(v_user_b)
    ),
    'conflicts', jsonb_build_object(
      'skills', coalesce((select jsonb_agg(a.name order by a.name) from public.skills a join public.skills b on lower(trim(a.name)) = lower(trim(b.name)) where a.user_id = v_user_a and b.user_id = v_user_b), '[]'::jsonb),
      'courses', coalesce((select jsonb_agg(a.name order by a.name) from public.courses a join public.courses b on lower(trim(a.name)) = lower(trim(b.name)) where a.user_id = v_user_a and b.user_id = v_user_b), '[]'::jsonb),
      'experience', coalesce((select jsonb_agg(a.title order by a.title) from public.experience a join public.experience b on lower(trim(a.title)) = lower(trim(b.title)) and lower(trim(coalesce(a.organization, ''))) = lower(trim(coalesce(b.organization, ''))) where a.user_id = v_user_a and b.user_id = v_user_b), '[]'::jsonb)
    )
  );
end
$$;

create or replace function private.profile_transfer_summary(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'profileId', learning_profile.id,
    'email', auth_user.email,
    'accountType', account.account_type,
    'counts', jsonb_build_object(
      'skills', (select count(*) from public.skills where user_id = p_user_id),
      'experience', (select count(*) from public.experience where user_id = p_user_id),
      'courses', (select count(*) from public.courses where user_id = p_user_id),
      'evidence', (select count(*) from public.skill_assessments where user_id = p_user_id and (evidence_url is not null or evidence_path is not null or coalesce(cardinality(evidence_paths), 0) > 0)),
      'connections', (select count(*) from public.connections where user_a_id = p_user_id or user_b_id = p_user_id),
      'integrations', (select count(*) from public.external_connections where user_id = p_user_id)
    )
  )
  from public.person_auth_accounts account
  join auth.users auth_user on auth_user.id = account.auth_user_id
  join public.learning_profiles learning_profile on learning_profile.legacy_user_id = auth_user.id
  where account.auth_user_id = p_user_id
$$;

revoke all on function private.profile_transfer_summary(uuid) from public, anon, authenticated;
revoke all on function public.request_profile_transfer_preview(uuid),
  public.approve_profile_transfer_preview(uuid), public.cancel_profile_transfer_preview(uuid),
  public.list_my_profile_transfer_previews(), public.get_profile_transfer_comparison(uuid)
from public, anon;
grant execute on function public.request_profile_transfer_preview(uuid),
  public.approve_profile_transfer_preview(uuid), public.cancel_profile_transfer_preview(uuid),
  public.list_my_profile_transfer_previews(), public.get_profile_transfer_comparison(uuid)
to authenticated;
