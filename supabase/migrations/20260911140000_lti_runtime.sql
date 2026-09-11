-- Private protocol state: authenticated clients have no direct privileges.
create table public.lti_transactions (
  state_hash text primary key,
  connection_id uuid not null references public.lti_connections(id),
  nonce text not null,
  binding_hash text not null,
  target text not null,
  deployment text,
  expires_at timestamptz not null default now() + interval '5 minutes',
  consumed boolean not null default false
);
create table public.lti_launch_sessions (
  token_hash text primary key,
  binding_hash text not null,
  connection_id uuid not null references public.lti_connections(id),
  deployment text not null,
  subject text not null,
  claims jsonb not null,
  expires_at timestamptz not null default now() + interval '1 hour',
  used boolean not null default false
);
create table public.lti_identities (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.lti_connections(id),
  subject text not null,
  registration_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(connection_id, registration_key, subject)
);
create index lti_identities_user_idx on public.lti_identities(user_id);
create table public.lti_grade_links (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.lti_identities(id) on delete cascade,
  object_id uuid not null references public.lti_skill_objects(id),
  deployment text not null,
  resource_link text not null,
  lineitem text not null,
  consent boolean not null default false,
  consented_at timestamptz,
  unique(identity_id, deployment, resource_link)
);
create index lti_grade_links_object_idx on public.lti_grade_links(object_id);
create table public.lti_grade_jobs (
  link_id uuid primary key references public.lti_grade_links(id) on delete cascade,
  revision bigint not null default 1,
  event_at timestamptz not null default clock_timestamp(),
  delivered_level integer,
  status text not null default 'pending' check(status in ('pending','delivered','failed','unassessed')),
  attempts integer not null default 0,
  next_attempt timestamptz not null default now(),
  lease_until timestamptz,
  error text
);
create index lti_grade_jobs_pending_idx on public.lti_grade_jobs(next_attempt) where status in ('pending','failed');
create index lti_transactions_expiry_idx on public.lti_transactions(expires_at);
create index lti_sessions_expiry_idx on public.lti_launch_sessions(expires_at);
do $$ declare t text; begin
  foreach t in array array['lti_transactions','lti_launch_sessions','lti_identities','lti_grade_links','lti_grade_jobs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
  end loop;
end $$;
-- Supabase's service role is the only runtime caller; browser writes stay forbidden.
grant select on public.lti_connections, public.lti_skill_objects, public.lti_object_connections to service_role;
create function public.lti_queue_grade(p_link uuid) returns void language sql security definer set search_path='' as $$
  insert into public.lti_grade_jobs(link_id) select id from public.lti_grade_links where id=p_link and consent
  on conflict(link_id) do update set revision=lti_grade_jobs.revision+1,event_at=clock_timestamp(),status='pending',attempts=0,next_attempt=now(),error=null;
$$;
revoke all on function public.lti_queue_grade(uuid) from public,anon,authenticated;
grant execute on function public.lti_queue_grade(uuid) to service_role;
create function public.lti_skill_grade_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.skills%rowtype; link uuid;
begin
  if tg_table_name='skills' then s:=new;
  else select * into s from public.skills where id=coalesce(new.skill_id,old.skill_id); end if;
  for link in select g.id from public.lti_grade_links g join public.lti_identities i on i.id=g.identity_id join public.lti_skill_objects o on o.id=g.object_id
    where i.user_id=s.user_id and o.skill_library_id=s.library_skill_id and g.consent loop
    perform public.lti_queue_grade(link);
  end loop;
  return null;
end $$;
revoke all on function public.lti_skill_grade_changed() from public,anon,authenticated;
create trigger lti_skill_grade_change after insert or update of level,library_skill_id on public.skills for each row execute function public.lti_skill_grade_changed();
create trigger lti_assessment_grade_change after insert or update or delete on public.skill_assessments for each row execute function public.lti_skill_grade_changed();
create function public.lti_claim_grade(p_link uuid) returns setof public.lti_grade_jobs language sql security definer set search_path='' as $$
  update public.lti_grade_jobs set lease_until=now()+interval '2 minutes', attempts=attempts+1
  where link_id=p_link and (lease_until is null or lease_until<now()) and next_attempt<=now() and status in ('pending','failed') and attempts<8 returning *;
$$;
revoke all on function public.lti_claim_grade(uuid) from public,anon,authenticated;
grant execute on function public.lti_claim_grade(uuid) to service_role;

create index lti_transactions_connection_idx on public.lti_transactions(connection_id);
create index lti_sessions_connection_subject_idx on public.lti_launch_sessions(connection_id,subject);
