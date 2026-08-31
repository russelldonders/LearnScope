-- External data source connections (OAuth), starting with Strava. This is
-- deliberately a different concept from "connections" (0058, learner-to-
-- learner social relationships) -- an external_connection links a learner
-- to their own account on a third-party service, not to another learner.
--
-- Tokens are held server-side only and never exposed to the client's own
-- Supabase session: RLS is enabled with zero policies granted to
-- authenticated/anon, so a plain client query returns nothing regardless of
-- ownership. The only two sanctioned access paths are (a) the service-role
-- client (supabaseAdmin(), used from api/strava/[...path].js -- same
-- pattern as api/xapi/[...path].js's launch-session lookups) for anything
-- touching the token columns, and (b) get_my_external_connections() below
-- for the one safe, non-secret read the client needs (status/last synced),
-- mirroring the existing is_connected()/upsert_connection() security-
-- definer precedent from 0058.
create table external_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  provider text not null check (provider in ('strava')),
  provider_account_id text not null,
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  scope text,
  status text not null default 'active' check (status in ('active', 'error')),
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (user_id, provider)
);

alter table external_connections enable row level security;

create index external_connections_user_id_idx on external_connections (user_id);

create or replace function get_my_external_connections()
returns table (
  id uuid,
  provider text,
  provider_account_id text,
  status text,
  connected_at timestamptz,
  last_synced_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select id, provider, provider_account_id, status, connected_at, last_synced_at
  from external_connections
  where user_id = auth.uid()
$$;

revoke all on function get_my_external_connections() from public;
grant execute on function get_my_external_connections() to authenticated;
