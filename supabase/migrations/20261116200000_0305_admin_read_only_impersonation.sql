-- Short-lived, read-only platform-administrator impersonation sessions.
--
-- The browser receives a normal target-user access token so every existing
-- learner query continues to run through exactly the same RLS policies the
-- learner sees. The session id from that token is registered here before the
-- token is returned to the administrator. A trigger on every application
-- table then rejects writes from that session, including writes made inside
-- SECURITY DEFINER RPCs (where an RLS-only guard would not be sufficient).
-- Rows are deliberately retained after expiry/end: an old access token must
-- remain recognisable as an impersonation token and must never turn back into
-- an unrestricted target-user session when the 15-minute window closes.

create table public.admin_impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  auth_session_id uuid not null unique,
  actor_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  reason text not null check (char_length(trim(reason)) between 10 and 500),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  constraint admin_impersonation_session_window check (
    expires_at > started_at and expires_at <= started_at + interval '15 minutes'
  ),
  constraint admin_impersonation_end_after_start check (ended_at is null or ended_at >= started_at)
);

create index admin_impersonation_sessions_actor_idx
  on public.admin_impersonation_sessions (actor_id, started_at desc);
create index admin_impersonation_sessions_target_idx
  on public.admin_impersonation_sessions (target_user_id, started_at desc);

comment on table public.admin_impersonation_sessions is
  'Permanent security/audit registry for short-lived read-only platform-admin impersonation sessions. Retained so an issued target-user token can never become writable after the preview ends.';

alter table public.admin_impersonation_sessions enable row level security;

create policy "Platform admins can view impersonation sessions"
  on public.admin_impersonation_sessions for select
  to authenticated
  using (public.is_platform_admin((select auth.uid())));

grant select on public.admin_impersonation_sessions to authenticated;
grant select, insert, update on public.admin_impersonation_sessions to service_role;

-- True for active, expired and explicitly ended impersonation sessions. Do
-- not add an expiry predicate here: the write prohibition is permanent for
-- the lifetime of the issued Auth session.
create or replace function public.is_admin_impersonation_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_impersonation_sessions ais
    where ais.auth_session_id = nullif(
      coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'session_id',
      ''
    )::uuid
  )
$$;

revoke all on function public.is_admin_impersonation_session() from public, anon, authenticated;

-- Ordinary sessions have no registry row and pass. An impersonation token
-- passes SELECT policies only while its exact session is active and within
-- the 15-minute window. This makes expiry a database boundary rather than a
-- browser-timer convention: a copied token cannot keep reading until its
-- longer Auth JWT lifetime ends.
create or replace function public.admin_impersonation_session_can_read()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with current_session as (
    select nullif(
      coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'session_id',
      ''
    )::uuid as id
  )
  select
    current_session.id is null
    or not exists (
      select 1 from public.admin_impersonation_sessions ais
      where ais.auth_session_id = current_session.id
    )
    or exists (
      select 1 from public.admin_impersonation_sessions ais
      where ais.auth_session_id = current_session.id
        and ais.ended_at is null
        and ais.expires_at > statement_timestamp()
    )
  from current_session
$$;

revoke all on function public.admin_impersonation_session_can_read() from public, anon;
grant execute on function public.admin_impersonation_session_can_read() to authenticated;

-- Trigger-level enforcement also covers SECURITY DEFINER functions, unlike
-- RLS policies which their owner may bypass.
create or replace function public.prevent_admin_impersonation_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_admin_impersonation_session() then
    raise insufficient_privilege
      using message = 'This is a read-only impersonation session. Changes are not allowed.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_admin_impersonation_write() from public, anon, authenticated;

-- Install the guard on every current application table. The registry itself
-- is excluded so the service-role API can close a session. Future migrations
-- that create a writable public table must attach this same trigger; the
-- database test below detects omissions.
do $$
declare
  v_table record;
begin
  for v_table in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and n.nspname = 'public'
      and c.relname <> 'admin_impersonation_sessions'
      and not exists (select 1 from pg_inherits i where i.inhrelid = c.oid)
    order by case c.relkind when 'p' then 0 else 1 end, c.relname
  loop
    execute format(
      'create trigger prevent_admin_impersonation_write before insert or update or delete on %I.%I for each row execute function public.prevent_admin_impersonation_write()',
      v_table.schema_name,
      v_table.table_name
    );
  end loop;
end
$$;

-- Add a restrictive SELECT policy alongside each table's existing
-- permissive ownership/sharing policies. Restrictive policies are ANDed, so
-- they do not grant any new row access; they only close an ended or expired
-- impersonation session. Every authenticated-readable application table has
-- RLS enabled (enforced by the database test suite).
do $$
declare
  v_table record;
begin
  for v_table in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and n.nspname = 'public'
      and c.relname <> 'admin_impersonation_sessions'
      and c.relrowsecurity
      and not exists (select 1 from pg_inherits i where i.inhrelid = c.oid)
    order by case c.relkind when 'p' then 0 else 1 end, c.relname
  loop
    execute format(
      'create policy "Active impersonation sessions can read" on %I.%I as restrictive for select to authenticated using ((select public.admin_impersonation_session_can_read()))',
      v_table.schema_name,
      v_table.table_name
    );
  end loop;
end
$$;

-- Storage mutations do not touch a public table, so protect its object rows
-- explicitly as well. Bucket configuration is platform-owned and not exposed
-- to learner sessions.
create trigger prevent_admin_impersonation_storage_write
  before insert or update or delete on storage.objects
  for each row execute function public.prevent_admin_impersonation_write();

create policy "Active impersonation sessions can read storage objects"
  on storage.objects as restrictive for select
  to authenticated
  using ((select public.admin_impersonation_session_can_read()));

