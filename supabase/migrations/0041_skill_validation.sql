-- Per-skill opt-in to being asked to validate someone else's claim to have
-- reached their target level on this same skill. Deliberately narrower and
-- separate from the existing account-level skills_profile_visible flag
-- (0016) -- that's about letting connections browse your skills profile;
-- this is specifically about offering to assess other people's evidence.
-- Off by default, matching every other cross-user visibility flag so far.
alter table skills add column offer_validate_connections boolean not null default false;
alter table skills add column offer_validate_others boolean not null default false;

-- A single ask: "will you confirm I've reached my target level for this
-- skill". One row per request. A requester can ask several different
-- validators in parallel, but not send a second pending request to the same
-- validator for the same skill while one is already outstanding.
create table skill_validation_requests (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid references skills(id) on delete cascade not null,
  requester_id uuid references auth.users(id) not null,
  validator_id uuid references auth.users(id) not null,
  target_level int not null check (target_level between 1 and 5),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'declined')),
  decision_comments text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table skill_validation_requests enable row level security;

create unique index skill_validation_requests_pending_idx
  on skill_validation_requests (skill_id, validator_id)
  where status = 'pending';

create index skill_validation_requests_skill_id_idx on skill_validation_requests (skill_id);
create index skill_validation_requests_validator_id_idx on skill_validation_requests (validator_id);

create policy "Requesters can view their own validation requests"
  on skill_validation_requests for select
  using (auth.uid() = requester_id);

create policy "Validators can view requests addressed to them"
  on skill_validation_requests for select
  using (auth.uid() = validator_id);

-- The eligibility rule is enforced here, not just in the client: the named
-- validator must actually have this same skill (by library_skill_id) at or
-- above the requested target level, already be in the maintaining phase
-- themselves, and have opted in -- either broadly (offer_validate_others) or
-- to connections specifically (offer_validate_connections), where
-- "connection" is defined the same way it already is elsewhere in the app:
-- an existing skill_peer_ratings row between the two accounts.
create policy "Requesters can create requests for their own skills, to eligible validators"
  on skill_validation_requests for insert
  with check (
    auth.uid() = requester_id
    and exists (
      select 1 from skills req
      where req.id = skill_id and req.user_id = auth.uid()
    )
    and exists (
      select 1 from skills req
      join skills val on val.library_skill_id = req.library_skill_id
      where req.id = skill_id
        and val.user_id = validator_id
        and val.lifecycle_stage in ('validated', 'maintained')
        and val.level >= target_level
        and (
          val.offer_validate_others = true
          or (
            val.offer_validate_connections = true
            and exists (
              select 1 from skill_peer_ratings spr
              where (spr.rater_id = auth.uid() and spr.skill_owner_id = validator_id)
                 or (spr.rater_id = validator_id and spr.skill_owner_id = auth.uid())
            )
          )
        )
    )
  );

create policy "Validators can decide on requests addressed to them"
  on skill_validation_requests for update
  using (auth.uid() = validator_id and status = 'pending')
  with check (auth.uid() = validator_id);

-- Evidence access grant: once a request naming them exists (whatever its
-- status), the validator can read that one skill's full record -- the skill
-- itself, its targets, self/AI/peer/course assessments, peer ratings,
-- linked training, and recorded activity. Access persists for as long as
-- the request row exists, so a validator can always refer back to what they
-- reviewed and decided.
create policy "Validators can view skills they're validating"
  on skills for select
  using (
    exists (
      select 1 from skill_validation_requests svr
      where svr.skill_id = skills.id and svr.validator_id = auth.uid()
    )
  );

create policy "Validators can view targets for skills they're validating"
  on skill_targets for select
  using (
    exists (
      select 1 from skill_validation_requests svr
      where svr.skill_id = skill_targets.skill_id and svr.validator_id = auth.uid()
    )
  );

create policy "Validators can view assessments for skills they're validating"
  on skill_assessments for select
  using (
    exists (
      select 1 from skill_validation_requests svr
      where svr.skill_id = skill_assessments.skill_id and svr.validator_id = auth.uid()
    )
  );

create policy "Validators can view peer ratings for skills they're validating"
  on skill_peer_ratings for select
  using (
    exists (
      select 1 from skill_validation_requests svr
      where svr.skill_id = skill_peer_ratings.skill_id and svr.validator_id = auth.uid()
    )
  );

create policy "Validators can view course links for skills they're validating"
  on skill_course_links for select
  using (
    exists (
      select 1 from skill_validation_requests svr
      where svr.skill_id = skill_course_links.skill_id and svr.validator_id = auth.uid()
    )
  );

create policy "Validators can view activity for skills they're validating"
  on xapi_statements for select
  using (
    skill_id is not null
    and exists (
      select 1 from skill_validation_requests svr
      where svr.skill_id = xapi_statements.skill_id and svr.validator_id = auth.uid()
    )
  );

-- Evidence files are stored at {owner_user_id}/{skill_id}/..., so this can
-- be scoped to the exact skill rather than the owner's whole evidence
-- library.
create policy "Validators can view evidence files for skills they're validating"
  on storage.objects for select
  using (
    bucket_id = 'skill-evidence'
    and exists (
      select 1 from skill_validation_requests svr
      where svr.validator_id = auth.uid()
        and svr.skill_id::text = (storage.foldername(name))[2]
    )
  );

-- Narrow discovery surface for "who could I ask to validate this skill" --
-- exposes only what's needed to pick someone (name, avatar, level, whether
-- they're a connection), not the rest of their skill record.
-- security_invoker ensures the view runs with the querying user's own
-- permissions, not the (highly privileged) view owner's, though the WHERE
-- clause below already enforces the same eligibility rule as the insert
-- policy above.
create view validator_directory
  with (security_invoker = true)
as
select
  s.id as skill_id,
  s.user_id as validator_id,
  s.library_skill_id,
  s.level,
  s.lifecycle_stage,
  s.offer_validate_connections,
  s.offer_validate_others,
  p.full_name,
  p.avatar_url,
  exists (
    select 1 from skill_peer_ratings spr
    where (spr.rater_id = auth.uid() and spr.skill_owner_id = s.user_id)
       or (spr.rater_id = s.user_id and spr.skill_owner_id = auth.uid())
  ) as is_connection
from skills s
join profiles p on p.id = s.user_id
where s.lifecycle_stage in ('validated', 'maintained')
  and s.user_id != auth.uid()
  and (
    s.offer_validate_others = true
    or (
      s.offer_validate_connections = true
      and exists (
        select 1 from skill_peer_ratings spr
        where (spr.rater_id = auth.uid() and spr.skill_owner_id = s.user_id)
           or (spr.rater_id = s.user_id and spr.skill_owner_id = auth.uid())
      )
    )
  );

grant select on validator_directory to authenticated;

-- Runs as the validator, but needs to update the requester's skill record
-- when confirming -- the same "security definer function performs the one
-- specific privileged action, after checking the caller is who they claim
-- to be" pattern already used by accept_invite_and_rate() (0010).
create or replace function decide_validation_request(p_request_id uuid, p_confirmed boolean, p_comments text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request skill_validation_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_request from skill_validation_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_request.validator_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_request.status != 'pending' then
    raise exception 'This request has already been decided.';
  end if;

  update skill_validation_requests
  set status = case when p_confirmed then 'confirmed' else 'declined' end,
      decision_comments = nullif(p_comments, ''),
      decided_at = now()
  where id = p_request_id;

  if p_confirmed then
    update skills
    set lifecycle_stage = 'validated', level = v_request.target_level
    where id = v_request.skill_id;
  end if;
end;
$$;

grant execute on function decide_validation_request(uuid, boolean, text) to authenticated;

-- The validator's email is never exposed through validator_directory (that
-- view is deliberately limited to name/avatar/level for browsing) -- it's
-- only revealed to the requester once a request already exists, so they can
-- send the notification email for that specific request.
create or replace function get_validation_request_contact(p_request_id uuid)
returns table (email text, full_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request skill_validation_requests%rowtype;
begin
  select * into v_request from skill_validation_requests where id = p_request_id;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_request.requester_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  return query
    select u.email, p.full_name
    from auth.users u
    left join profiles p on p.id = u.id
    where u.id = v_request.validator_id;
end;
$$;

grant execute on function get_validation_request_contact(uuid) to authenticated;
