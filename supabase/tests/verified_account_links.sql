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
