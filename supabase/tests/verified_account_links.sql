\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, email_confirmed_at)
values
  ('10000000-0000-0000-0000-000000000001', 'work@example.com', now()),
  ('20000000-0000-0000-0000-000000000002', 'personal@example.com', now()),
  ('30000000-0000-0000-0000-000000000003', 'other@example.com', now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
create temporary table account_link_test_invitation as
select token from public.create_account_link_invitation('personal@example.com');

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', true);
do $$
declare v_token text;
begin
  select token into v_token from account_link_test_invitation;
  perform public.redeem_account_link_invitation(v_token);
  raise exception 'wrong-email redemption unexpectedly succeeded';
exception
  when others then
    if sqlerrm not like '%Sign in with the invited email address%' then raise; end if;
end
$$;

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
create temporary table account_link_test_result as
select public.redeem_account_link_invitation(token) as link_id
from account_link_test_invitation;

do $$
begin
  if not exists (
    select 1 from public.verified_account_links
    where id = (select link_id from account_link_test_result) and status = 'active'
  ) then
    raise exception 'verified link was not created';
  end if;
end
$$;

do $$
begin
  if (select count(*) from public.list_my_verified_account_links()) <> 1 then
    raise exception 'verified account was not visible to its participant';
  end if;
end
$$;

create temporary table profile_preview_test_result as
select public.request_profile_transfer_preview(link_id) as preview_id
from account_link_test_result;

do $$
begin
  perform public.get_profile_transfer_comparison((select preview_id from profile_preview_test_result));
  raise exception 'comparison was visible before both accounts approved';
exception
  when others then
    if sqlerrm not like '%Approved transfer preview not found%' then raise; end if;
end
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select public.approve_profile_transfer_preview(preview_id) from profile_preview_test_result;

do $$
declare v_comparison jsonb;
begin
  select public.get_profile_transfer_comparison(preview_id)
  into v_comparison from profile_preview_test_result;
  if jsonb_array_length(v_comparison -> 'profiles') <> 2 then
    raise exception 'approved comparison did not return both profiles';
  end if;
end
$$;

-- Build an exact transfer plan. A duplicate must be resolved before the plan
-- can be frozen, and the second account must approve that exact hash.
reset role;
insert into public.skills (user_id, name, category, level)
values
  ('10000000-0000-0000-0000-000000000001', 'SQL', 'Technical', 4),
  ('20000000-0000-0000-0000-000000000002', 'SQL', 'Technical', 3),
  ('20000000-0000-0000-0000-000000000002', 'Facilitation', 'Leadership', 4);

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);

create temporary table transfer_plan_test_result as
select public.create_profile_transfer_plan(
  preview_id,
  '10000000-0000-0000-0000-000000000001'
) as plan_id from profile_preview_test_result;

do $$
declare v_plan jsonb;
begin
  select public.get_profile_transfer_plan(plan_id) into v_plan from transfer_plan_test_result;
  if v_plan ->> 'currentProfileId' <> '20000000-0000-0000-0000-000000000002'
     or jsonb_array_length(v_plan -> 'items') <> 2 then
    raise exception 'transfer plan review projection is incomplete';
  end if;
end
$$;

do $$
begin
  perform public.submit_profile_transfer_plan((select plan_id from transfer_plan_test_result));
  raise exception 'plan with unresolved conflicts unexpectedly submitted';
exception
  when others then
    if sqlerrm not like '%Resolve every conflict%' then raise; end if;
end
$$;

select public.resolve_profile_transfer_plan_item(
  plan_id,
  (select id from public.profile_transfer_plan_items
   where plan_id = transfer_plan_test_result.plan_id and action = 'unresolved' limit 1),
  'use_source'
) from transfer_plan_test_result;

create temporary table transfer_plan_hash_result as
select public.submit_profile_transfer_plan(plan_id) as version_hash
from transfer_plan_test_result;

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', true);
do $$
begin
  perform public.get_profile_transfer_plan((select plan_id from transfer_plan_test_result));
  raise exception 'unlinked account unexpectedly viewed transfer plan';
exception
  when others then
    if sqlerrm not like '%Transfer plan not found%' then raise; end if;
end
$$;

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);

do $$
begin
  perform public.resolve_profile_transfer_plan_item(
    (select plan_id from transfer_plan_test_result),
    (select id from public.profile_transfer_plan_items where plan_id = (select plan_id from transfer_plan_test_result) limit 1),
    'keep_durable'
  );
  raise exception 'submitted plan unexpectedly remained editable';
exception
  when others then
    if sqlerrm not like '%Editable transfer plan not found%' then raise; end if;
end
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
do $$
begin
  perform public.approve_profile_transfer_plan((select plan_id from transfer_plan_test_result), 'wrong-version');
  raise exception 'wrong plan version unexpectedly approved';
exception
  when others then
    if sqlerrm not like '%version has changed%' then raise; end if;
end
$$;

select public.approve_profile_transfer_plan(plan_id, version_hash)
from transfer_plan_test_result cross join transfer_plan_hash_result;

do $$
begin
  if not exists (
    select 1 from public.profile_transfer_plans
    where id = (select plan_id from transfer_plan_test_result)
      and status = 'approved' and approved_at is not null
  ) then raise exception 'two-party plan approval did not complete'; end if;
  if (select count(*) from public.profile_transfer_plan_events
      where plan_id = (select plan_id from transfer_plan_test_result)) <> 4 then
    raise exception 'transfer plan audit trail is incomplete';
  end if;
end
$$;

select public.revoke_verified_account_link(link_id) from account_link_test_result;

reset role;
do $$
begin
  if not exists (
    select 1 from public.verified_account_links
    where id = (select link_id from account_link_test_result) and status = 'revoked' and revoked_at is not null
  ) then
    raise exception 'verified link was not revoked';
  end if;
end
$$;

rollback;
