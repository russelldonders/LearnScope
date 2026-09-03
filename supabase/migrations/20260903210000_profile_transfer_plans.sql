-- Immutable, two-party-approved transfer plans. This phase records intent only:
-- no learner-owned row is moved, merged, deleted, or reassigned here.

create table public.profile_transfer_plans (
  id uuid primary key default gen_random_uuid(),
  preview_id uuid not null references public.profile_transfer_previews(id) on delete restrict,
  verified_account_link_id uuid not null references public.verified_account_links(id) on delete restrict,
  source_profile_id uuid not null references public.learning_profiles(id) on delete restrict,
  durable_profile_id uuid not null references public.learning_profiles(id) on delete restrict,
  created_by_auth_account_id uuid not null references public.person_auth_accounts(id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'cancelled', 'expired', 'executed')),
  version_hash text,
  expires_at timestamptz not null default (now() + interval '7 days'),
  submitted_at timestamptz,
  approved_at timestamptz,
  cancelled_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_profile_id <> durable_profile_id),
  check (expires_at > created_at),
  check (
    (status = 'draft' and submitted_at is null)
    or status in ('cancelled', 'expired')
    or (status in ('pending_approval', 'approved', 'executed') and submitted_at is not null)
  ),
  check ((status in ('approved', 'executed')) = (approved_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check ((status = 'executed') = (executed_at is not null)),
  check ((status = 'draft') or version_hash is not null)
);

create unique index profile_transfer_plans_open_link_idx
  on public.profile_transfer_plans (verified_account_link_id)
  where status in ('draft', 'pending_approval', 'approved');
create index profile_transfer_plans_preview_idx on public.profile_transfer_plans (preview_id);

create table public.profile_transfer_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.profile_transfer_plans(id) on delete cascade,
  domain text not null check (domain in ('skills', 'courses', 'experience')),
  source_record_id uuid not null,
  durable_record_id uuid,
  record_label text not null,
  action text not null check (action in ('move', 'keep_durable', 'use_source', 'unresolved')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (plan_id, domain, source_record_id),
  check ((durable_record_id is null) = (action = 'move')),
  check ((action <> 'unresolved') or durable_record_id is not null)
);

create index profile_transfer_plan_items_plan_idx
  on public.profile_transfer_plan_items (plan_id, domain, action);

create table public.profile_transfer_plan_approvals (
  plan_id uuid not null references public.profile_transfer_plans(id) on delete cascade,
  auth_account_id uuid not null references public.person_auth_accounts(id) on delete restrict,
  version_hash text not null,
  approved_at timestamptz not null default now(),
  primary key (plan_id, auth_account_id)
);

create table public.profile_transfer_plan_events (
  id bigint generated always as identity primary key,
  plan_id uuid not null references public.profile_transfer_plans(id) on delete restrict,
  actor_auth_account_id uuid references public.person_auth_accounts(id) on delete set null,
  event_type text not null check (event_type in (
    'created', 'conflict_resolved', 'submitted', 'approved',
    'approval_withdrawn', 'cancelled', 'expired', 'executed'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index profile_transfer_plan_events_plan_idx
  on public.profile_transfer_plan_events (plan_id, created_at);

alter table public.profile_transfer_plans enable row level security;
alter table public.profile_transfer_plan_items enable row level security;
alter table public.profile_transfer_plan_approvals enable row level security;
alter table public.profile_transfer_plan_events enable row level security;

revoke all on public.profile_transfer_plans, public.profile_transfer_plan_items,
  public.profile_transfer_plan_approvals from anon, authenticated;
revoke all on public.profile_transfer_plan_events from anon, authenticated;
grant select on public.profile_transfer_plans, public.profile_transfer_plan_items,
  public.profile_transfer_plan_approvals to authenticated;
grant select on public.profile_transfer_plan_events to authenticated;

-- The ownership helper is used inside the policies below. Its body only
-- returns the caller's own active account for the supplied active link.
grant execute on function private.current_link_account(uuid) to authenticated;

create policy "Linked accounts can view their transfer plans"
  on public.profile_transfer_plans for select to authenticated
  using (private.current_link_account(verified_account_link_id) is not null);

create policy "Linked accounts can view their transfer plan items"
  on public.profile_transfer_plan_items for select to authenticated
  using (exists (
    select 1 from public.profile_transfer_plans plan
    where plan.id = profile_transfer_plan_items.plan_id
      and private.current_link_account(plan.verified_account_link_id) is not null
  ));

create policy "Linked accounts can view their transfer plan approvals"
  on public.profile_transfer_plan_approvals for select to authenticated
  using (exists (
    select 1 from public.profile_transfer_plans plan
    where plan.id = profile_transfer_plan_approvals.plan_id
      and private.current_link_account(plan.verified_account_link_id) is not null
  ));

create policy "Linked accounts can view their transfer plan audit events"
  on public.profile_transfer_plan_events for select to authenticated
  using (exists (
    select 1 from public.profile_transfer_plans plan
    where plan.id = profile_transfer_plan_events.plan_id
      and private.current_link_account(plan.verified_account_link_id) is not null
  ));

create or replace function private.profile_transfer_plan_hash(p_plan_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(
    convert_to(jsonb_build_object(
      'planId', plan.id,
      'previewId', plan.preview_id,
      'sourceProfileId', plan.source_profile_id,
      'durableProfileId', plan.durable_profile_id,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', item.id, 'domain', item.domain,
          'sourceRecordId', item.source_record_id,
          'durableRecordId', item.durable_record_id,
          'action', item.action, 'metadata', item.metadata
        ) order by item.domain, item.source_record_id)
        from public.profile_transfer_plan_items item where item.plan_id = plan.id
      ), '[]'::jsonb)
    )::text, 'utf8'), 'sha256'), 'hex')
  from public.profile_transfer_plans plan where plan.id = p_plan_id
$$;
revoke all on function private.profile_transfer_plan_hash(uuid) from public, anon, authenticated;

create or replace function public.create_profile_transfer_plan(
  p_preview_id uuid,
  p_durable_profile_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_preview public.profile_transfer_previews;
  v_link public.verified_account_links;
  v_account_id uuid;
  v_profile_a uuid;
  v_profile_b uuid;
  v_source_profile_id uuid;
  v_source_user_id uuid;
  v_durable_user_id uuid;
  v_plan_id uuid;
begin
  select * into v_preview from public.profile_transfer_previews where id = p_preview_id for update;
  if v_preview.id is null or v_preview.status <> 'approved' or v_preview.expires_at <= now() then
    raise exception 'Approved transfer preview not found';
  end if;
  v_account_id := private.current_link_account(v_preview.verified_account_link_id);
  if v_account_id is null then raise exception 'Active verified account link not found'; end if;
  select * into v_link from public.verified_account_links where id = v_preview.verified_account_link_id;

  select learning_profile.id into v_profile_a
  from public.person_auth_accounts account
  join public.learning_profiles learning_profile on learning_profile.legacy_user_id = account.auth_user_id
  where account.id = v_link.auth_account_a_id and learning_profile.profile_type = 'personal';
  select learning_profile.id into v_profile_b
  from public.person_auth_accounts account
  join public.learning_profiles learning_profile on learning_profile.legacy_user_id = account.auth_user_id
  where account.id = v_link.auth_account_b_id and learning_profile.profile_type = 'personal';

  if p_durable_profile_id not in (v_profile_a, v_profile_b) then
    raise exception 'Durable profile must belong to the verified account link';
  end if;
  v_source_profile_id := case when p_durable_profile_id = v_profile_a then v_profile_b else v_profile_a end;
  select legacy_user_id into v_source_user_id from public.learning_profiles where id = v_source_profile_id;
  select legacy_user_id into v_durable_user_id from public.learning_profiles where id = p_durable_profile_id;

  update public.profile_transfer_plans set status = 'expired', approved_at = null, updated_at = now()
  where verified_account_link_id = v_link.id
    and status in ('draft', 'pending_approval', 'approved') and expires_at <= now();
  if exists (select 1 from public.profile_transfer_plans where verified_account_link_id = v_link.id and status in ('draft', 'pending_approval', 'approved')) then
    raise exception 'An active transfer plan already exists';
  end if;

  insert into public.profile_transfer_plans (
    preview_id, verified_account_link_id, source_profile_id, durable_profile_id,
    created_by_auth_account_id
  ) values (p_preview_id, v_link.id, v_source_profile_id, p_durable_profile_id, v_account_id)
  returning id into v_plan_id;

  insert into public.profile_transfer_plan_items
    (plan_id, domain, source_record_id, durable_record_id, record_label, action, metadata)
  select v_plan_id, 'skills', source.id, durable.id, source.name,
    case when durable.id is null then 'move' else 'unresolved' end,
    jsonb_build_object(
      'sourceLevel', source.level, 'durableLevel', durable.level,
      'sourceFingerprint', encode(extensions.digest(convert_to(to_jsonb(source)::text, 'utf8'), 'sha256'), 'hex'),
      'durableFingerprint', durable.fingerprint
    )
  from public.skills source
  left join lateral (
    select target.id, target.level,
      encode(extensions.digest(convert_to(to_jsonb(target)::text, 'utf8'), 'sha256'), 'hex') as fingerprint
    from public.skills target
    where target.user_id = v_durable_user_id and lower(trim(target.name)) = lower(trim(source.name))
    order by target.date_added desc limit 1
  ) durable on true
  where source.user_id = v_source_user_id;

  insert into public.profile_transfer_plan_items
    (plan_id, domain, source_record_id, durable_record_id, record_label, action, metadata)
  select v_plan_id, 'courses', source.id, durable.id, source.name,
    case when durable.id is null then 'move' else 'unresolved' end,
    jsonb_build_object(
      'sourceProvider', source.provider, 'durableProvider', durable.provider,
      'sourceFingerprint', encode(extensions.digest(convert_to(to_jsonb(source)::text, 'utf8'), 'sha256'), 'hex'),
      'durableFingerprint', durable.fingerprint
    )
  from public.courses source
  left join lateral (
    select target.id, target.provider,
      encode(extensions.digest(convert_to(to_jsonb(target)::text, 'utf8'), 'sha256'), 'hex') as fingerprint
    from public.courses target
    where target.user_id = v_durable_user_id and lower(trim(target.name)) = lower(trim(source.name))
    order by target.created_at desc limit 1
  ) durable on true
  where source.user_id = v_source_user_id;

  insert into public.profile_transfer_plan_items
    (plan_id, domain, source_record_id, durable_record_id, record_label, action, metadata)
  select v_plan_id, 'experience', source.id, durable.id, source.title,
    case when durable.id is null then 'move' else 'unresolved' end,
    jsonb_build_object(
      'sourceOrganization', source.organization, 'durableOrganization', durable.organization,
      'sourceFingerprint', encode(extensions.digest(convert_to(to_jsonb(source)::text, 'utf8'), 'sha256'), 'hex'),
      'durableFingerprint', durable.fingerprint
    )
  from public.experience source
  left join lateral (
    select target.id, target.organization,
      encode(extensions.digest(convert_to(to_jsonb(target)::text, 'utf8'), 'sha256'), 'hex') as fingerprint
    from public.experience target
    where target.user_id = v_durable_user_id
      and lower(trim(target.title)) = lower(trim(source.title))
      and lower(trim(coalesce(target.organization, ''))) = lower(trim(coalesce(source.organization, '')))
    order by target.created_at desc limit 1
  ) durable on true
  where source.user_id = v_source_user_id;
  insert into public.profile_transfer_plan_events (plan_id, actor_auth_account_id, event_type, details)
  values (v_plan_id, v_account_id, 'created', jsonb_build_object('durableProfileId', p_durable_profile_id));
  return v_plan_id;
end
$$;

create or replace function public.resolve_profile_transfer_plan_item(
  p_plan_id uuid, p_item_id uuid, p_action text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_plan public.profile_transfer_plans;
begin
  select * into v_plan from public.profile_transfer_plans where id = p_plan_id for update;
  if v_plan.id is null or v_plan.status <> 'draft' or v_plan.expires_at <= now()
     or private.current_link_account(v_plan.verified_account_link_id) is null then
    raise exception 'Editable transfer plan not found';
  end if;
  if p_action not in ('keep_durable', 'use_source') then raise exception 'Invalid conflict resolution'; end if;
  update public.profile_transfer_plan_items
  set action = p_action
  where id = p_item_id and plan_id = p_plan_id and durable_record_id is not null;
  if not found then raise exception 'Conflict item not found'; end if;
  insert into public.profile_transfer_plan_events (plan_id, actor_auth_account_id, event_type, details)
  values (p_plan_id, private.current_link_account(v_plan.verified_account_link_id), 'conflict_resolved',
    jsonb_build_object('itemId', p_item_id, 'action', p_action));
end
$$;

create or replace function public.submit_profile_transfer_plan(p_plan_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_plan public.profile_transfer_plans; v_account_id uuid; v_hash text;
begin
  select * into v_plan from public.profile_transfer_plans where id = p_plan_id for update;
  v_account_id := private.current_link_account(v_plan.verified_account_link_id);
  if v_plan.id is null or v_plan.status <> 'draft' or v_plan.expires_at <= now() or v_account_id is null then
    raise exception 'Editable transfer plan not found';
  end if;
  if exists (select 1 from public.profile_transfer_plan_items where plan_id = p_plan_id and action = 'unresolved') then
    raise exception 'Resolve every conflict before requesting approval';
  end if;
  v_hash := private.profile_transfer_plan_hash(p_plan_id);
  update public.profile_transfer_plans set status = 'pending_approval', version_hash = v_hash,
    submitted_at = now(), updated_at = now() where id = p_plan_id;
  insert into public.profile_transfer_plan_approvals (plan_id, auth_account_id, version_hash)
  values (p_plan_id, v_account_id, v_hash);
  insert into public.profile_transfer_plan_events (plan_id, actor_auth_account_id, event_type, details)
  values (p_plan_id, v_account_id, 'submitted', jsonb_build_object('versionHash', v_hash));
  return v_hash;
end
$$;

create or replace function public.approve_profile_transfer_plan(p_plan_id uuid, p_version_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_plan public.profile_transfer_plans; v_account_id uuid;
begin
  select * into v_plan from public.profile_transfer_plans where id = p_plan_id for update;
  v_account_id := private.current_link_account(v_plan.verified_account_link_id);
  if v_plan.id is null or v_plan.status <> 'pending_approval' or v_plan.expires_at <= now() or v_account_id is null then
    raise exception 'Transfer plan awaiting approval not found';
  end if;
  if p_version_hash is distinct from v_plan.version_hash
     or private.profile_transfer_plan_hash(p_plan_id) is distinct from v_plan.version_hash then
    raise exception 'Transfer plan version has changed';
  end if;
  insert into public.profile_transfer_plan_approvals (plan_id, auth_account_id, version_hash)
  values (p_plan_id, v_account_id, v_plan.version_hash) on conflict do nothing;
  insert into public.profile_transfer_plan_events (plan_id, actor_auth_account_id, event_type, details)
  select p_plan_id, v_account_id, 'approved', jsonb_build_object('versionHash', v_plan.version_hash)
  where not exists (
    select 1 from public.profile_transfer_plan_events event
    where event.plan_id = p_plan_id and event.actor_auth_account_id = v_account_id
      and event.event_type = 'approved' and event.details ->> 'versionHash' = v_plan.version_hash
  );
  if (select count(*) from public.profile_transfer_plan_approvals where plan_id = p_plan_id and version_hash = v_plan.version_hash) = 2 then
    update public.profile_transfer_plans set status = 'approved', approved_at = now(), updated_at = now()
    where id = p_plan_id;
  end if;
end
$$;

create or replace function public.withdraw_profile_transfer_plan_approval(p_plan_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_plan public.profile_transfer_plans; v_account_id uuid;
begin
  select * into v_plan from public.profile_transfer_plans where id = p_plan_id for update;
  v_account_id := private.current_link_account(v_plan.verified_account_link_id);
  if v_plan.id is null or v_plan.status not in ('pending_approval', 'approved') or v_account_id is null then
    raise exception 'Active submitted transfer plan not found';
  end if;
  delete from public.profile_transfer_plan_approvals where plan_id = p_plan_id and auth_account_id = v_account_id;
  if not found then raise exception 'Approval not found'; end if;
  update public.profile_transfer_plans set status = 'pending_approval', approved_at = null, updated_at = now()
  where id = p_plan_id;
  insert into public.profile_transfer_plan_events (plan_id, actor_auth_account_id, event_type, details)
  values (p_plan_id, v_account_id, 'approval_withdrawn', jsonb_build_object('versionHash', v_plan.version_hash));
end
$$;

create or replace function public.cancel_profile_transfer_plan(p_plan_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.profile_transfer_plans plan set status = 'cancelled', cancelled_at = now(),
    approved_at = null, updated_at = now()
  where plan.id = p_plan_id and plan.status in ('draft', 'pending_approval', 'approved')
    and private.current_link_account(plan.verified_account_link_id) is not null;
  if not found then raise exception 'Active transfer plan not found'; end if;
  insert into public.profile_transfer_plan_events (plan_id, actor_auth_account_id, event_type)
  values (p_plan_id, private.current_link_account((select verified_account_link_id from public.profile_transfer_plans where id = p_plan_id)), 'cancelled');
end
$$;

create or replace function public.list_my_profile_transfer_plans()
returns table (
  plan_id uuid, preview_id uuid, link_id uuid, status text, version_hash text,
  source_profile_id uuid, source_email text, durable_profile_id uuid, durable_email text,
  approved_by_me boolean, approval_count integer, expires_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select plan.id, plan.preview_id, plan.verified_account_link_id,
    case when plan.status in ('draft', 'pending_approval', 'approved') and plan.expires_at <= now() then 'expired' else plan.status end,
    plan.version_hash, plan.source_profile_id, source_user.email,
    plan.durable_profile_id, durable_user.email,
    exists (select 1 from public.profile_transfer_plan_approvals approval
      where approval.plan_id = plan.id and approval.auth_account_id = mine.id
        and approval.version_hash = plan.version_hash),
    (select count(*)::integer from public.profile_transfer_plan_approvals approval
      where approval.plan_id = plan.id and approval.version_hash = plan.version_hash),
    plan.expires_at
  from public.profile_transfer_plans plan
  join public.person_auth_accounts mine on mine.id = private.current_link_account(plan.verified_account_link_id)
  join public.learning_profiles source_profile on source_profile.id = plan.source_profile_id
  join auth.users source_user on source_user.id = source_profile.legacy_user_id
  join public.learning_profiles durable_profile on durable_profile.id = plan.durable_profile_id
  join auth.users durable_user on durable_user.id = durable_profile.legacy_user_id
  order by plan.created_at desc
$$;

create or replace function public.get_profile_transfer_plan(p_plan_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_plan public.profile_transfer_plans;
begin
  select * into v_plan from public.profile_transfer_plans where id = p_plan_id;
  if v_plan.id is null or private.current_link_account(v_plan.verified_account_link_id) is null then
    raise exception 'Transfer plan not found';
  end if;
  return jsonb_build_object(
    'id', v_plan.id, 'status', case when v_plan.status in ('draft', 'pending_approval', 'approved') and v_plan.expires_at <= now() then 'expired' else v_plan.status end,
    'versionHash', v_plan.version_hash, 'sourceProfileId', v_plan.source_profile_id,
    'durableProfileId', v_plan.durable_profile_id, 'expiresAt', v_plan.expires_at,
    'approvedByMe', exists (select 1 from public.profile_transfer_plan_approvals approval
      where approval.plan_id = v_plan.id and approval.auth_account_id = private.current_link_account(v_plan.verified_account_link_id)
        and approval.version_hash = v_plan.version_hash),
    'approvalCount', (select count(*) from public.profile_transfer_plan_approvals approval
      where approval.plan_id = v_plan.id and approval.version_hash = v_plan.version_hash),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', item.id, 'domain', item.domain, 'sourceRecordId', item.source_record_id,
      'durableRecordId', item.durable_record_id, 'label', item.record_label,
      'action', item.action, 'metadata', item.metadata
    ) order by item.domain, item.record_label) from public.profile_transfer_plan_items item where item.plan_id = v_plan.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
      'type', event.event_type, 'details', event.details, 'createdAt', event.created_at
    ) order by event.created_at) from public.profile_transfer_plan_events event where event.plan_id = v_plan.id), '[]'::jsonb)
  );
end
$$;

revoke all on function public.create_profile_transfer_plan(uuid, uuid),
  public.resolve_profile_transfer_plan_item(uuid, uuid, text), public.submit_profile_transfer_plan(uuid),
  public.approve_profile_transfer_plan(uuid, text), public.withdraw_profile_transfer_plan_approval(uuid),
  public.cancel_profile_transfer_plan(uuid), public.list_my_profile_transfer_plans(),
  public.get_profile_transfer_plan(uuid) from public, anon;
grant execute on function public.create_profile_transfer_plan(uuid, uuid),
  public.resolve_profile_transfer_plan_item(uuid, uuid, text), public.submit_profile_transfer_plan(uuid),
  public.approve_profile_transfer_plan(uuid, text), public.withdraw_profile_transfer_plan_approval(uuid),
  public.cancel_profile_transfer_plan(uuid), public.list_my_profile_transfer_plans(),
  public.get_profile_transfer_plan(uuid) to authenticated;
