-- ============================================================================
-- Skill discovery + direct connections
--
-- Introduces "connections" as a first-class relationship (previously only
-- ever inferred from skill_peer_ratings), a direct connection-request flow
-- with a message, and opt-in skill-search discoverability so a learner can
-- be found by people tracking the same library skill even before they're
-- connected. Off by default throughout, matching the existing privacy-by-
-- design precedent (see 0016_skills_profile_privacy.sql).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. connections: the new source of truth for "these two people are
-- connected". Normalized so each pair appears once regardless of which side
-- created it (user_a_id is always the lexicographically smaller id).
-- ----------------------------------------------------------------------------
create table connections (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid references auth.users(id) not null,
  user_b_id uuid references auth.users(id) not null,
  source text not null check (source in ('peer_rating', 'request')),
  created_at timestamptz not null default now(),
  check (user_a_id <> user_b_id),
  unique (user_a_id, user_b_id)
);

create index connections_user_a_id_idx on connections (user_a_id);
create index connections_user_b_id_idx on connections (user_b_id);

alter table connections enable row level security;

create policy "Users can view their own connections"
  on connections for select
  using (auth.uid() = user_a_id or auth.uid() = user_b_id);

-- Normalizes the pair order and no-ops if the connection already exists
-- (from either the peer-rating trigger below or an accepted request), so
-- callers never have to know or care which side is "a" vs "b".
create or replace function upsert_connection(p_user_1 uuid, p_user_2 uuid, p_source text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_user_1 = p_user_2 then
    return;
  end if;
  insert into connections (user_a_id, user_b_id, source)
  values (least(p_user_1, p_user_2), greatest(p_user_1, p_user_2), p_source)
  on conflict (user_a_id, user_b_id) do nothing;
end;
$$;

-- A peer rating has always meant two accounts interacted directly -- it now
-- also establishes a standing connection, not just a rating event.
create or replace function sync_connection_from_peer_rating()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform upsert_connection(new.rater_id, new.skill_owner_id, 'peer_rating');
  return new;
end;
$$;

create trigger skill_peer_ratings_sync_connection
  after insert on skill_peer_ratings
  for each row execute function sync_connection_from_peer_rating();

-- Backfill: every pair that has already exchanged a rating is already a
-- connection today by the app's existing (inferred) definition -- carry
-- that forward rather than resetting everyone to disconnected.
insert into connections (user_a_id, user_b_id, source)
select distinct least(rater_id, skill_owner_id), greatest(rater_id, skill_owner_id), 'peer_rating'
from skill_peer_ratings
where rater_id <> skill_owner_id
on conflict (user_a_id, user_b_id) do nothing;

-- Centralizes "are these two people connected" behind the connections
-- table -- existing callers (the 0016 skills-visibility policy,
-- validator_directory, etc.) keep working unchanged since the function
-- signature doesn't change, they just become correct for request-based
-- connections too.
create or replace function is_connected(a uuid, b uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from connections
    where user_a_id = least(a, b) and user_b_id = greatest(a, b)
  )
$$;

-- ----------------------------------------------------------------------------
-- 2. connection_requests: a direct, targeted request to connect (with an
-- optional short message), distinct from the existing per-skill
-- connection_invites share-code flow -- this one names a specific person
-- rather than generating a link anyone can accept.
-- ----------------------------------------------------------------------------
create table connection_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid references auth.users(id) not null,
  recipient_id uuid references auth.users(id) not null,
  skill_id uuid references skills(id) on delete set null,
  message text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (requester_id <> recipient_id)
);

-- Prevents sending a second request while one is already pending between
-- the same two people.
create unique index connection_requests_pending_pair_idx
  on connection_requests (requester_id, recipient_id)
  where status = 'pending';

alter table connection_requests enable row level security;

create policy "Users can view requests they sent or received"
  on connection_requests for select
  using (auth.uid() = requester_id or auth.uid() = recipient_id);

create policy "Users can send a connection request"
  on connection_requests for insert
  with check (auth.uid() = requester_id);

-- Only the recipient can act on it, and only the status/decided_at may
-- change -- everything else about the original request stays as sent.
create policy "Recipients can accept or decline"
  on connection_requests for update
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

create or replace function sync_connection_from_request()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    new.decided_at := now();
    perform upsert_connection(new.requester_id, new.recipient_id, 'request');
  elsif new.status = 'declined' and old.status is distinct from 'declined' then
    new.decided_at := now();
  end if;
  return new;
end;
$$;

create trigger connection_requests_sync_connection
  before update on connection_requests
  for each row execute function sync_connection_from_request();

-- ----------------------------------------------------------------------------
-- 3. Skill-search discoverability -- opt-in, off by default. Three modes:
-- never appear in skill-match searches, always appear, or a selective
-- per-skill list (profile_searchable_skills).
-- ----------------------------------------------------------------------------
alter table profiles add column skill_search_visibility text
  not null default 'hidden'
  check (skill_search_visibility in ('hidden', 'all', 'selective'));

alter table profiles add column auto_include_new_skills_in_search boolean not null default false;

-- Separate from skills_profile_visible (0016), which only ever gated
-- existing connections viewing each other's skills profile. This gates the
-- new case: someone who shares a skill but isn't connected yet.
alter table profiles add column profile_visible_to_skill_matches boolean not null default false;

create table profile_searchable_skills (
  profile_id uuid references auth.users(id) not null,
  skill_id uuid references skills(id) on delete cascade not null,
  primary key (profile_id, skill_id)
);

alter table profile_searchable_skills enable row level security;

create policy "Users can view their own searchable-skills list"
  on profile_searchable_skills for select
  using (auth.uid() = profile_id);

create policy "Users can manage their own searchable-skills list"
  on profile_searchable_skills for insert
  with check (auth.uid() = profile_id);

create policy "Users can remove from their own searchable-skills list"
  on profile_searchable_skills for delete
  using (auth.uid() = profile_id);

-- When "selective" mode + "auto-include new skills" are both on, a newly
-- added skill opts itself in immediately rather than silently staying
-- invisible until the learner remembers to go add it.
create or replace function sync_new_skill_search_visibility()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_mode text;
  v_auto boolean;
begin
  select skill_search_visibility, auto_include_new_skills_in_search
    into v_mode, v_auto
    from profiles where id = new.user_id;

  if v_mode = 'selective' and v_auto then
    insert into profile_searchable_skills (profile_id, skill_id)
    values (new.user_id, new.id)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

create trigger skills_sync_search_visibility
  after insert on skills
  for each row execute function sync_new_skill_search_visibility();

-- Anonymized-by-default cross-user lookup, mirroring count_skill_trackers
-- (0053) and validator_directory (0056): SECURITY DEFINER so it can see
-- past normal per-row RLS, but it only ever returns rows for people who
-- have explicitly opted into skill-search visibility, and only exposes a
-- name/profile-view invitation when the viewer is further allowed to see
-- it (profile_visible_to_skill_matches, or they're already connected).
create or replace function list_skill_matches(p_library_skill_id uuid)
returns table (
  user_id uuid,
  full_name text,
  avatar_url text,
  level int,
  lifecycle_stage text,
  is_connection boolean,
  profile_viewable boolean,
  has_pending_request boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.user_id,
    p.full_name,
    p.avatar_url,
    s.level,
    s.lifecycle_stage,
    is_connected(auth.uid(), s.user_id) as is_connection,
    (p.profile_visible_to_skill_matches or is_connected(auth.uid(), s.user_id)) as profile_viewable,
    exists (
      select 1 from connection_requests cr
      where cr.status = 'pending'
        and ((cr.requester_id = auth.uid() and cr.recipient_id = s.user_id)
          or (cr.requester_id = s.user_id and cr.recipient_id = auth.uid()))
    ) as has_pending_request
  from skills s
  join profiles p on p.id = s.user_id
  where s.library_skill_id = p_library_skill_id
    and s.user_id <> auth.uid()
    and (
      p.skill_search_visibility = 'all'
      or (
        p.skill_search_visibility = 'selective'
        and exists (
          select 1 from profile_searchable_skills pss
          where pss.profile_id = s.user_id and pss.skill_id = s.id
        )
      )
    )
  order by p.full_name nulls last;
$$;

grant execute on function list_skill_matches(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Lets a skill-search match actually open the profile, when the owner
-- has opted in via profile_visible_to_skill_matches -- additive to (not a
-- replacement for) the existing 0016 connections-only policy, same pattern
-- it already documents: Postgres RLS ORs permissive SELECT policies
-- together, so a viewer only needs to satisfy one of them.
-- ----------------------------------------------------------------------------
create policy "Skill-search matches can view opted-in profiles"
  on skills for select
  using (
    exists (
      select 1 from profiles p
      where p.id = skills.user_id and p.profile_visible_to_skill_matches = true
    )
    and skills.library_skill_id is not null
    and exists (
      select 1 from skills my_skills
      where my_skills.user_id = auth.uid()
        and my_skills.library_skill_id = skills.library_skill_id
    )
  );
