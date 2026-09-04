-- 20260903210000_profile_transfer_plans.sql is deployed and immutable
-- (docs/claude-account-portability-handoff.md's own safety rule), so this
-- is a new migration that redefines create_profile_transfer_plan, not an
-- edit to that file.
--
-- Bug found while testing the transfer executor: skills has a column
-- literally named `source` (`source text not null default 'manual'`,
-- 0008_skill_source.sql). The original function's skills query aliases the
-- table itself as `source` too -- `from public.skills source ...
-- to_jsonb(source)`. Postgres resolves the bare identifier `source` inside
-- `to_jsonb(source)` as the *column* `skills.source` (e.g. the text
-- "manual"), not the aliased row, because a column reference takes
-- precedence over a range-table/composite-type reference with the same
-- name. The stored `sourceFingerprint` for every skills plan item ever
-- created was therefore a hash of a four-to-nine-character string like
-- "manual" or "cv_import", not a hash of the row -- silently defeating the
-- staleness check entirely for the skills domain (any two skills sharing
-- the same `source` value would compute identical fingerprints regardless
-- of name/level/notes/anything else). Confirmed directly: `select
-- to_jsonb(source)::text from public.skills source where ...` returns
-- `"manual"`, not the row JSON, against a real row. courses/experience are
-- unaffected -- neither table has a column named `source` or `target`
-- (the aliases their fingerprint queries use), so no collision exists
-- there.
--
-- Fixed by renaming the skills query's outer alias from `source` to `src`
-- (the `target`/`durable` aliases were never ambiguous and are unchanged).
-- Every other line of this function, including the courses and experience
-- blocks, is byte-identical to the original.

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
  select v_plan_id, 'skills', src.id, durable.id, src.name,
    case when durable.id is null then 'move' else 'unresolved' end,
    jsonb_build_object(
      'sourceLevel', src.level, 'durableLevel', durable.level,
      'sourceFingerprint', encode(extensions.digest(convert_to(to_jsonb(src)::text, 'utf8'), 'sha256'), 'hex'),
      'durableFingerprint', durable.fingerprint
    )
  from public.skills src
  left join lateral (
    select target.id, target.level,
      encode(extensions.digest(convert_to(to_jsonb(target)::text, 'utf8'), 'sha256'), 'hex') as fingerprint
    from public.skills target
    where target.user_id = v_durable_user_id and lower(trim(target.name)) = lower(trim(src.name))
    order by target.date_added desc limit 1
  ) durable on true
  where src.user_id = v_source_user_id;

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
