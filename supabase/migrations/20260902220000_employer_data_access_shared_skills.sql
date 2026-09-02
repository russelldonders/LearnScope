-- Refines Phase 5 (employer_data_access_requests, 20260902200000/210000) from
-- an all-or-nothing grant to per-skill sharing. Previously, once a request
-- reached 'approved', has_employer_data_access made the learner's ENTIRE
-- skills/skill_assessments visible to that employer's admins. This migration
-- adds an explicit join table of which skills the learner actually chose to
-- share, and re-points the two additive SELECT policies at a per-skill check
-- instead. request_employer_data_access is untouched -- skill selection now
-- happens at accept/share time (decide_employer_data_access_request,
-- share_data_with_employer) or any time after via the new
-- update_shared_employer_skills, not at request time.

-- ----------------------------------------------------------------------------
-- employer_data_access_shared_skills -- one row per skill actually shared
-- under a given employer_data_access_requests row. Select-only RLS: every
-- write goes through the security definer RPCs below, mirroring
-- employer_data_access_requests' own "no insert/update policy at all" shape.
-- ----------------------------------------------------------------------------

create table employer_data_access_shared_skills (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references employer_data_access_requests(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (request_id, skill_id)
);

alter table employer_data_access_shared_skills enable row level security;

create index employer_data_access_shared_skills_request_idx on employer_data_access_shared_skills (request_id);
create index employer_data_access_shared_skills_skill_idx on employer_data_access_shared_skills (skill_id);

create policy "Parties to a data access request can view its shared skills"
  on employer_data_access_shared_skills for select
  to authenticated
  using (
    exists (
      select 1 from employer_data_access_requests r
      where r.id = request_id and r.learner_id = auth.uid()
    )
    or exists (
      select 1 from employer_data_access_requests r
      where r.id = request_id and is_employer_admin(r.employer_id, auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- Helper -- replaces has_employer_data_access as the predicate the skills/
-- skill_assessments RLS policies rely on. Preserves the exact fix from
-- 20260902210000 (the is_employer_member re-check) so a shared skill stops
-- being visible the moment the learner leaves/is removed from the employer,
-- not just when they revoke.
-- ----------------------------------------------------------------------------

create or replace function is_skill_shared_with_employer(p_skill_id uuid, p_check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from employer_data_access_shared_skills eas
    join employer_data_access_requests r on r.id = eas.request_id
    where eas.skill_id = p_skill_id
      and r.status = 'approved'
      and is_employer_admin(r.employer_id, p_check_user_id)
      and is_employer_member(r.employer_id, r.learner_id)
  )
$$;

grant execute on function is_skill_shared_with_employer(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Internal helper, not granted to authenticated -- called only from the
-- security definer RPCs below, which already establish p_request_id belongs
-- to the caller before delegating here. Validates every id in p_skill_ids
-- actually belongs to a skills row owned by the caller (defense in depth --
-- the UI never constructs a call with someone else's skill id, but the RPCs
-- shouldn't trust that), then replaces the request's shared-skill set
-- wholesale. `distinct` guards against a duplicate id in the input array
-- tripping the (request_id, skill_id) unique constraint.
-- ----------------------------------------------------------------------------

create or replace function set_employer_data_access_shared_skills(p_request_id uuid, p_skill_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from unnest(p_skill_ids) as sid
    where not exists (select 1 from skills where id = sid and user_id = auth.uid())
  ) then
    raise exception 'One or more selected skills do not belong to you.';
  end if;

  delete from employer_data_access_shared_skills where request_id = p_request_id;

  insert into employer_data_access_shared_skills (request_id, skill_id)
  select distinct p_request_id, sid from unnest(p_skill_ids) as sid;
end;
$$;

-- ----------------------------------------------------------------------------
-- decide_employer_data_access_request -- adds p_skill_ids (defaulted, so
-- existing callers passing just 2 args would fail to resolve now that the
-- signature has changed identity; drop the old 2-arg overload explicitly
-- rather than leaving a dangling stale signature behind).
-- ----------------------------------------------------------------------------

drop function if exists decide_employer_data_access_request(uuid, boolean);

create or replace function decide_employer_data_access_request(
  p_request_id uuid,
  p_accept boolean,
  p_skill_ids uuid[] default array[]::uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row employer_data_access_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from employer_data_access_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_row.learner_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_row.status != 'pending' then
    raise exception 'This request has already been decided.';
  end if;

  update employer_data_access_requests
  set status = case when p_accept then 'approved' else 'declined' end,
      decided_at = now()
  where id = p_request_id;

  -- Decline needs no skill-set change -- there shouldn't be any yet.
  if p_accept then
    perform set_employer_data_access_shared_skills(p_request_id, p_skill_ids);
  end if;
end;
$$;

grant execute on function decide_employer_data_access_request(uuid, boolean, uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- share_data_with_employer -- same shape change as above.
-- ----------------------------------------------------------------------------

drop function if exists share_data_with_employer(uuid);

create or replace function share_data_with_employer(p_employer_id uuid, p_skill_ids uuid[] default array[]::uuid[])
returns employer_data_access_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row employer_data_access_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from employer_members
    where employer_id = p_employer_id and user_id = auth.uid() and status = 'active'
  ) then
    raise exception 'You are not an active member of this employer.';
  end if;

  insert into employer_data_access_requests (employer_id, learner_id, requested_by, status, decided_at)
  values (p_employer_id, auth.uid(), null, 'approved', now())
  on conflict (employer_id, learner_id) do update
    set status = 'approved', requested_by = null, decided_at = now()
  returning * into v_row;

  perform set_employer_data_access_shared_skills(v_row.id, p_skill_ids);

  return v_row;
end;
$$;

grant execute on function share_data_with_employer(uuid, uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- New: update_shared_employer_skills -- lets a learner change their mind
-- about which skills are shared with an already-approved employer, without
-- having to revoke and re-share from scratch. Only edits a live grant.
-- ----------------------------------------------------------------------------

create or replace function update_shared_employer_skills(p_request_id uuid, p_skill_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row employer_data_access_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from employer_data_access_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_row.learner_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_row.status != 'approved' then
    raise exception 'This access grant is not currently active.';
  end if;

  perform set_employer_data_access_shared_skills(p_request_id, p_skill_ids);
end;
$$;

grant execute on function update_shared_employer_skills(uuid, uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- revoke_employer_data_access -- same signature, now also clears the shared-
-- skill set so a future share_data_with_employer/accept for the same
-- (employer, learner) pair starts clean rather than silently reactivating
-- stale selections.
-- ----------------------------------------------------------------------------

create or replace function revoke_employer_data_access(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row employer_data_access_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from employer_data_access_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_row.learner_id != auth.uid() then
    raise exception 'Not authorized';
  end if;
  if v_row.status != 'approved' then
    raise exception 'This access grant is not currently active.';
  end if;

  update employer_data_access_requests
  set status = 'revoked', decided_at = now()
  where id = p_request_id;

  delete from employer_data_access_shared_skills where request_id = p_request_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Re-point the two additive RLS policies (20260902200000) at the new
-- per-skill predicate, then drop has_employer_data_access -- nothing else
-- references it (confirmed by grep across supabase/migrations).
-- ----------------------------------------------------------------------------

drop policy "Employers with granted access can view skills" on skills;
drop policy "Employers with granted access can view skill assessments" on skill_assessments;

create policy "Employers with granted access can view skills"
  on skills for select
  using (is_skill_shared_with_employer(skills.id, auth.uid()));

create policy "Employers with granted access can view skill assessments"
  on skill_assessments for select
  using (is_skill_shared_with_employer(skill_assessments.skill_id, auth.uid()));

drop function if exists has_employer_data_access(uuid, uuid);
