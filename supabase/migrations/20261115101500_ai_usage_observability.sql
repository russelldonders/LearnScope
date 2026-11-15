-- Privacy-safe AI observability. This records metering and attribution only:
-- prompts, source documents and generated content never enter this table.
create table public.ai_usage_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  organisation_id uuid references public.organisations(id) on delete set null,
  feature text not null check (length(trim(feature)) > 0),
  provider text not null default 'anthropic' check (length(trim(provider)) > 0),
  model text not null check (length(trim(model)) > 0),
  status text not null check (status in ('success', 'refusal', 'error')),
  request_id text,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  thinking_tokens bigint not null default 0 check (thinking_tokens >= 0 and thinking_tokens <= output_tokens),
  cache_creation_input_tokens bigint not null default 0 check (cache_creation_input_tokens >= 0),
  cache_read_input_tokens bigint not null default 0 check (cache_read_input_tokens >= 0),
  duration_ms integer not null check (duration_ms >= 0),
  estimated_cost_micro_usd bigint not null default 0 check (estimated_cost_micro_usd >= 0),
  pricing_version date not null,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  check (jsonb_typeof(metadata) = 'object')
);

comment on table public.ai_usage_events is
  'Server-written token, estimated cost and latency events for AI features. Never stores prompts, uploaded content or generated responses.';
comment on column public.ai_usage_events.estimated_cost_micro_usd is
  'Estimated cost in millionths of a US dollar, calculated from the pricing snapshot identified by pricing_version.';

create index ai_usage_events_occurred_at_idx
  on public.ai_usage_events (occurred_at desc);
create index ai_usage_events_feature_occurred_at_idx
  on public.ai_usage_events (feature, occurred_at desc);
create index ai_usage_events_organisation_occurred_at_idx
  on public.ai_usage_events (organisation_id, occurred_at desc)
  where organisation_id is not null;
create index ai_usage_events_user_occurred_at_idx
  on public.ai_usage_events (user_id, occurred_at desc)
  where user_id is not null;
create index ai_usage_events_request_id_idx
  on public.ai_usage_events (request_id)
  where request_id is not null;

alter table public.ai_usage_events enable row level security;

-- Only platform administrators can read metering data. Writes are made by
-- server-side service-role code and have no authenticated-client policy.
create policy "Platform admins can view AI usage"
  on public.ai_usage_events for select
  to authenticated
  using (public.is_platform_admin((select auth.uid())));

revoke all on table public.ai_usage_events from anon, authenticated;
grant select on table public.ai_usage_events to authenticated;
grant select, insert on table public.ai_usage_events to service_role;
grant usage, select on sequence public.ai_usage_events_id_seq to service_role;

-- One bounded aggregate call keeps the admin dashboard fast even after the
-- underlying ledger grows. SECURITY INVOKER preserves the table's RLS.
create or replace function public.get_ai_usage_dashboard(p_days integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_since timestamptz;
  v_result jsonb;
begin
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'AI usage range must be between 1 and 90 days';
  end if;

  if not public.is_platform_admin((select auth.uid())) then
    raise insufficient_privilege using message = 'Platform administrator access required';
  end if;

  v_since := date_trunc('day', now()) - make_interval(days => p_days - 1);

  with filtered as (
    select *
    from public.ai_usage_events
    where occurred_at >= v_since
  ), calendar as (
    select generate_series(
      date_trunc('day', v_since),
      date_trunc('day', now()),
      interval '1 day'
    )::date as day
  )
  select jsonb_build_object(
    'days', p_days,
    'generatedAt', now(),
    'totals', (
      select jsonb_build_object(
        'requests', count(*),
        'successfulRequests', count(*) filter (where status = 'success'),
        'refusals', count(*) filter (where status = 'refusal'),
        'errors', count(*) filter (where status = 'error'),
        'inputTokens', coalesce(sum(input_tokens), 0),
        'outputTokens', coalesce(sum(output_tokens), 0),
        'cacheCreationTokens', coalesce(sum(cache_creation_input_tokens), 0),
        'cacheReadTokens', coalesce(sum(cache_read_input_tokens), 0),
        'totalTokens', coalesce(sum(input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens), 0),
        'estimatedCostMicroUsd', coalesce(sum(estimated_cost_micro_usd), 0),
        'averageDurationMs', coalesce(round(avg(duration_ms)), 0)
      )
      from filtered
    ),
    'byDay', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', c.day,
        'requests', coalesce(d.requests, 0),
        'tokens', coalesce(d.tokens, 0),
        'estimatedCostMicroUsd', coalesce(d.cost, 0)
      ) order by c.day), '[]'::jsonb)
      from calendar c
      left join (
        select occurred_at::date as day,
               count(*) as requests,
               sum(input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens) as tokens,
               sum(estimated_cost_micro_usd) as cost
        from filtered
        group by occurred_at::date
      ) d using (day)
    ),
    'byFeature', (
      select coalesce(jsonb_agg(row_data order by (row_data->>'estimatedCostMicroUsd')::bigint desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'feature', feature,
          'requests', count(*),
          'errors', count(*) filter (where status = 'error'),
          'tokens', sum(input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens),
          'estimatedCostMicroUsd', sum(estimated_cost_micro_usd),
          'averageDurationMs', round(avg(duration_ms))
        ) as row_data
        from filtered
        group by feature
      ) feature_rows
    ),
    'byModel', (
      select coalesce(jsonb_agg(row_data order by (row_data->>'estimatedCostMicroUsd')::bigint desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'model', model,
          'requests', count(*),
          'tokens', sum(input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens),
          'estimatedCostMicroUsd', sum(estimated_cost_micro_usd)
        ) as row_data
        from filtered
        group by model
      ) model_rows
    ),
    'byOrganisation', (
      select coalesce(jsonb_agg(row_data order by (row_data->>'estimatedCostMicroUsd')::bigint desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'organisationId', f.organisation_id,
          'organisationName', coalesce(o.name, 'Not attributed'),
          'requests', count(*),
          'tokens', sum(f.input_tokens + f.output_tokens + f.cache_creation_input_tokens + f.cache_read_input_tokens),
          'estimatedCostMicroUsd', sum(f.estimated_cost_micro_usd)
        ) as row_data
        from filtered f
        left join public.organisations o on o.id = f.organisation_id
        group by f.organisation_id, o.name
      ) organisation_rows
    ),
    'recentErrors', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'occurredAt', occurred_at,
        'feature', feature,
        'model', model,
        'errorCode', error_code,
        'requestId', request_id
      ) order by occurred_at desc), '[]'::jsonb)
      from (
        select occurred_at, feature, model, error_code, request_id
        from filtered
        where status = 'error'
        order by occurred_at desc
        limit 10
      ) errors
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_ai_usage_dashboard(integer) from public, anon;
grant execute on function public.get_ai_usage_dashboard(integer) to authenticated;
