-- Phase 5 of the employer domain concept: explicit, learner-controlled
-- consent for an employer admin to see a member's skills profile, beyond
-- whatever the employer's own training already exposes automatically via
-- is_course_provider_admin (0105) -- that mechanism is untouched here. This
-- is purely additive: an employer admin can request access to a specific
-- active member's skills profile, the learner explicitly accepts or
-- declines, and an accepted grant can be revoked by the learner at any time.
-- A learner can also proactively share without being asked. Nothing here
-- lets an employer read a learner's skills/assessments without one of these
-- two explicit, learner-controlled acts having happened.
--
-- One row per (employer, learner) relationship -- re-requesting after a
-- decline, or re-sharing after a revoke, resets that same row rather than
-- erroring on the unique constraint or accumulating history rows. This
-- intentionally does NOT preserve a full audit trail of every past
-- request/grant/revoke cycle (unlike skill_validation_requests, which keeps
-- one row per ask) -- only the current relationship state matters for
-- access control, and CLAUDE.md's historical-accuracy principle is about
-- learner development data (skills, proficiency, achievements), not this
-- kind of access-grant bookkeeping.

create table employer_data_access_requests (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references employers(id) on delete cascade,
  learner_id uuid not null references auth.users(id),
  requested_by uuid references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (employer_id, learner_id)
);

alter table employer_data_access_requests enable row level security;

create index employer_data_access_requests_learner_idx on employer_data_access_requests (learner_id);
create index employer_data_access_requests_employer_idx on employer_data_access_requests (employer_id);

-- No insert/update policy at all -- every write goes through the RPCs below,
-- so eligibility (active membership) and consent-state transitions are
-- always enforced server-side rather than relyable on client-side checks.
create policy "Learners can view their own data access requests"
  on employer_data_access_requests for select
  to authenticated
  using (learner_id = auth.uid());

create policy "Employer admins can view their employer's data access requests"
  on employer_data_access_requests for select
  to authenticated
  using (is_employer_admin(employer_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- Helper -- mirrors is_connected's (0051) style: a plain boolean predicate
-- for RLS policies elsewhere. security definer (unlike is_connected, which
-- is invoker) because this needs to evaluate is_employer_admin for the
-- *checking* user against a row's employer_id regardless of whose RLS
-- context is asking -- the same reasoning is_employer_admin/is_employer_
-- member (20260902090000) already rely on for themselves.
-- ----------------------------------------------------------------------------

create or replace function has_employer_data_access(p_learner_id uuid, p_check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from employer_data_access_requests r
    where r.learner_id = p_learner_id
      and r.status = 'approved'
      and is_employer_admin(r.employer_id, p_check_user_id)
  )
$$;

grant execute on function has_employer_data_access(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- RPCs -- security definer, mirroring decide_employer_invite's (20260902160000)
-- guard shape: row-lock with `for update`, explicit ownership/role check,
-- explicit status guard, raise a clear exception rather than silently no-op.
-- ----------------------------------------------------------------------------

-- Employer admin requests access to a specific active member's skills
-- profile. Idempotent: a live pending/approved row is returned unchanged
-- rather than reset, so a repeated request doesn't spam-reset an existing
-- pending ask or silently downgrade an existing approval back to pending.
create or replace function request_employer_data_access(p_employer_id uuid, p_learner_id uuid)
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
  if not is_employer_admin(p_employer_id, auth.uid()) then
    raise exception 'Not authorized';
  end if;
  if not exists (
    select 1 from employer_members
    where employer_id = p_employer_id and user_id = p_learner_id and status = 'active'
  ) then
    raise exception 'This person is not an active member of this employer.';
  end if;

  select * into v_row
  from employer_data_access_requests
  where employer_id = p_employer_id and learner_id = p_learner_id
  for update;

  if not found then
    insert into employer_data_access_requests (employer_id, learner_id, requested_by, status)
    values (p_employer_id, p_learner_id, auth.uid(), 'pending')
    returning * into v_row;
  elsif v_row.status in ('declined', 'revoked') then
    update employer_data_access_requests
    set status = 'pending', requested_by = auth.uid(), decided_at = null
    where id = v_row.id
    returning * into v_row;
  end if;
  -- status already 'pending' or 'approved': return the existing row as-is.

  return v_row;
end;
$$;

grant execute on function request_employer_data_access(uuid, uuid) to authenticated;

-- Learner accepts or declines a pending request.
create or replace function decide_employer_data_access_request(p_request_id uuid, p_accept boolean)
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
end;
$$;

grant execute on function decide_employer_data_access_request(uuid, boolean) to authenticated;

-- Learner-initiated proactive share -- no request needed. Caller must
-- actually be an active member of the employer they're sharing with.
create or replace function share_data_with_employer(p_employer_id uuid)
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

  return v_row;
end;
$$;

grant execute on function share_data_with_employer(uuid) to authenticated;

-- Learner revokes a live grant, whether it came from an accepted request or
-- a proactive share.
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
end;
$$;

grant execute on function revoke_employer_data_access(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- New additive RLS policies -- layer on top of each table's existing
-- owner-only policy, mirroring exactly how "Connections can view visible
-- skills profiles" (0051) layers on top of skills' own
-- "Users manage their own skills" policy. Scope is deliberately just these
-- two tables (a learner's skills + the assessments/evidence behind them)
-- for this phase.
-- ----------------------------------------------------------------------------

create policy "Employers with granted access can view skills"
  on skills for select
  using (has_employer_data_access(skills.user_id, auth.uid()));

create policy "Employers with granted access can view skill assessments"
  on skill_assessments for select
  using (has_employer_data_access(skill_assessments.user_id, auth.uid()));
