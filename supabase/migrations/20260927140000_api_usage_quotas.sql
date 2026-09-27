-- Per-user usage caps for the paid/abusable serverless endpoints (AI calls,
-- CV parsing, outgoing emails, team invites). Before this, one throwaway
-- account could loop any of them without limit -- running up the Anthropic
-- bill or sending mail/invites at volume.
--
-- A plain sliding-window event log, written and read only by the service
-- role through consume_api_quota; learners have no access at all. Rows only
-- record that a call happened (user, bucket, time) -- no content -- and are
-- pruned as they age out of the window. Deleting the account cascades.

create table public.api_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null check (char_length(bucket) between 1 and 40),
  created_at timestamptz not null default now()
);

create index api_usage_events_user_bucket_time_idx
  on public.api_usage_events (user_id, bucket, created_at);

alter table public.api_usage_events enable row level security;
revoke all on table public.api_usage_events from public, anon, authenticated;

-- Returns true (and records the call) when the user is still under p_limit
-- calls in the trailing window, false otherwise. The advisory lock makes the
-- count-then-insert atomic per user+bucket, so parallel requests can't all
-- slip under the limit together.
create function public.consume_api_quota(p_user_id uuid, p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_bucket, 0));

  delete from public.api_usage_events
  where user_id = p_user_id
    and bucket = p_bucket
    and created_at < now() - make_interval(secs => p_window_seconds);

  select count(*) into v_count
  from public.api_usage_events
  where user_id = p_user_id and bucket = p_bucket;

  if v_count >= p_limit then
    return false;
  end if;

  insert into public.api_usage_events (user_id, bucket) values (p_user_id, p_bucket);
  return true;
end;
$$;

revoke all on function public.consume_api_quota(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_quota(uuid, text, integer, integer) to service_role;
