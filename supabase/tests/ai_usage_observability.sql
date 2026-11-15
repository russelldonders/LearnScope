\set ON_ERROR_STOP on

begin;

select plan(5);

insert into auth.users (id, email, email_confirmed_at) values
  ('7a000000-0000-0000-0000-000000000001', 'ai-admin@example.com', now()),
  ('7a000000-0000-0000-0000-000000000002', 'ai-user@example.com', now());

insert into public.platform_admins (user_id)
values ('7a000000-0000-0000-0000-000000000001');

do $$
begin
  if not has_table_privilege('authenticated', 'public.ai_usage_events', 'select') then
    raise exception 'authenticated role is missing select access';
  end if;
  if has_table_privilege('authenticated', 'public.ai_usage_events', 'insert') then
    raise exception 'authenticated role can insert metering events';
  end if;
  if not has_function_privilege('authenticated', 'public.get_ai_usage_dashboard(integer)', 'execute') then
    raise exception 'authenticated role cannot load AI usage aggregates';
  end if;
end
$$;
select pass('AI usage grants expose only admin-readable operations');

set local role service_role;
insert into public.ai_usage_events (
  user_id, feature, model, status, input_tokens, output_tokens,
  thinking_tokens, duration_ms, estimated_cost_micro_usd, pricing_version
) values (
  '7a000000-0000-0000-0000-000000000002', 'course_draft_generation',
  'claude-haiku-4-5-20251001', 'success', 100, 20, 0, 750, 200, '2026-11-15'
);
reset role;

select set_config('request.jwt.claim.sub', '7a000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select is((select count(*) from public.ai_usage_events), 0::bigint,
  'non-admin users cannot read AI usage rows');

do $$
begin
  perform public.get_ai_usage_dashboard(30);
  raise exception 'non-admin loaded AI usage dashboard';
exception
  when insufficient_privilege then null;
end
$$;
select pass('non-admin users cannot load AI usage aggregates');

do $$
begin
  insert into public.ai_usage_events (
    feature, model, status, duration_ms, pricing_version
  ) values ('forged', 'forged-model', 'success', 1, current_date);
  raise exception 'authenticated user inserted a forged AI usage event';
exception
  when insufficient_privilege then null;
end
$$;
select pass('authenticated users cannot write AI usage events');

reset role;
select set_config('request.jwt.claim.sub', '7a000000-0000-0000-0000-000000000001', true);
set local role authenticated;

do $$
declare
  dashboard jsonb := public.get_ai_usage_dashboard(30);
begin
  if (dashboard #>> '{totals,requests}')::integer <> 1
     or (dashboard #>> '{totals,totalTokens}')::integer <> 120
     or (dashboard #>> '{totals,estimatedCostMicroUsd}')::integer <> 200
     or dashboard #>> '{byFeature,0,feature}' <> 'course_draft_generation' then
    raise exception 'AI usage dashboard totals are incorrect: %', dashboard;
  end if;
end
$$;
select pass('platform admins receive correct AI usage aggregates');

select * from finish();

rollback;
