-- Skill development targets keep the skill as the core object while
-- preserving the learner/employer ownership boundary. Learner-authored
-- targets continue to live in skill_targets. These rows are owned by an
-- employer and attach to the learner's membership in that employer, not to
-- the learner's personal skills row.
create table public.employer_skill_development_targets (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers(id) on delete cascade,
  employer_member_id uuid not null references public.employer_members(id) on delete cascade,
  skill_library_id uuid not null references public.skill_library(id) on delete restrict,
  target_level smallint not null check (target_level between 1 and 5),
  target_date date not null,
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled', 'superseded')),
  replaces_target_id uuid references public.employer_skill_development_targets(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  closed_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint employer_skill_development_target_closed_state check (
    (status = 'active' and closed_at is null and closed_by is null)
    or (status <> 'active' and closed_at is not null and closed_by is not null)
  )
);

create unique index employer_skill_development_targets_one_active_idx
  on public.employer_skill_development_targets
  (employer_id, employer_member_id, skill_library_id)
  where status = 'active';

create index employer_skill_development_targets_member_idx
  on public.employer_skill_development_targets
  (employer_member_id, status, target_date);

create index employer_skill_development_targets_employer_idx
  on public.employer_skill_development_targets
  (employer_id, status, target_date);

alter table public.employer_skill_development_targets enable row level security;

-- Learners can read targets belonging to their own employment context.
-- Employer admins retain their existing employer-wide administrative view.
-- Managers intentionally have no direct-table policy: their narrower view is
-- projected through the scope-checked RPC below.
create policy "Learners and employer admins view employer skill targets"
  on public.employer_skill_development_targets for select
  to authenticated
  using (
    public.is_employer_admin(employer_id, (select auth.uid()))
    or exists (
      select 1
      from public.employer_members member
      where member.id = employer_member_id
        and member.employer_id = employer_id
        and member.user_id = (select auth.uid())
    )
  );

revoke all on table public.employer_skill_development_targets from public, anon, authenticated;
grant select on table public.employer_skill_development_targets to authenticated;

create or replace function public.list_managed_employer_skill_development_targets(
  p_employer_id uuid,
  p_employee_member_id uuid
)
returns table (
  id uuid,
  skill_library_id uuid,
  skill_name text,
  target_level smallint,
  target_date date,
  notes text,
  status text,
  created_at timestamptz,
  closed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_employer_member(
    auth.uid(), p_employee_member_id, 'skill_management', true
  ) or not exists (
    select 1
    from public.employer_members member
    where member.id = p_employee_member_id
      and member.employer_id = p_employer_id
      and member.status = 'active'
  ) then
    raise exception 'Not authorised';
  end if;

  return query
  select target.id, target.skill_library_id, library_skill.name,
    target.target_level, target.target_date, target.notes, target.status,
    target.created_at, target.closed_at
  from public.employer_skill_development_targets target
  join public.skill_library library_skill on library_skill.id = target.skill_library_id
  where target.employer_id = p_employer_id
    and target.employer_member_id = p_employee_member_id
  order by (target.status = 'active') desc, target.created_at desc, target.id;
end
$$;

create or replace function public.list_my_employer_skill_development_targets()
returns table (
  id uuid,
  employer_id uuid,
  employer_name text,
  employer_member_id uuid,
  skill_library_id uuid,
  skill_name text,
  target_level smallint,
  target_date date,
  notes text,
  status text,
  created_at timestamptz,
  closed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select target.id, target.employer_id, employer.name,
    target.employer_member_id, target.skill_library_id, library_skill.name,
    target.target_level, target.target_date, target.notes, target.status,
    target.created_at, target.closed_at
  from public.employer_skill_development_targets target
  join public.employer_members member
    on member.id = target.employer_member_id
   and member.employer_id = target.employer_id
  join public.employers employer on employer.id = target.employer_id
  join public.skill_library library_skill on library_skill.id = target.skill_library_id
  where member.user_id = auth.uid()
  order by (target.status = 'active') desc, target.target_date, target.created_at desc, target.id
$$;

-- Setting a target is history-preserving. An existing active target is closed
-- as superseded and the replacement points back to it. No learner-owned skill
-- or skill_targets row is created or updated.
create or replace function public.set_managed_employer_skill_development_target(
  p_employer_id uuid,
  p_employee_member_id uuid,
  p_skill_library_id uuid,
  p_target_level integer,
  p_target_date date,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_id uuid;
  v_target_id uuid;
begin
  if not private.can_manage_employer_member(
    auth.uid(), p_employee_member_id, 'skill_management', true
  ) or not exists (
    select 1
    from public.employer_members member
    where member.id = p_employee_member_id
      and member.employer_id = p_employer_id
      and member.status = 'active'
  ) then
    raise exception 'Not authorised';
  end if;

  if p_target_level is null or p_target_level < 1 or p_target_level > 5 then
    raise exception 'Target level must be between 1 and 5';
  end if;

  if p_target_date is null or p_target_date < current_date then
    raise exception 'Target date cannot be in the past';
  end if;

  if not exists (
    select 1
    from public.employers employer
    join public.organisation_offered_skills offered_skill
      on offered_skill.organisation_id = employer.provider_organisation_id
    where employer.id = p_employer_id
      and offered_skill.skill_library_id = p_skill_library_id
  ) then
    raise exception 'This skill is not offered by this employer';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_employer_id::text || ':' || p_employee_member_id::text || ':' || p_skill_library_id::text,
      0
    )
  );

  select target.id into v_previous_id
  from public.employer_skill_development_targets target
  where target.employer_id = p_employer_id
    and target.employer_member_id = p_employee_member_id
    and target.skill_library_id = p_skill_library_id
    and target.status = 'active'
  for update;

  if v_previous_id is not null then
    update public.employer_skill_development_targets
    set status = 'superseded', closed_by = auth.uid(), closed_at = now()
    where id = v_previous_id;
  end if;

  insert into public.employer_skill_development_targets (
    employer_id, employer_member_id, skill_library_id, target_level,
    target_date, notes, replaces_target_id, created_by
  ) values (
    p_employer_id, p_employee_member_id, p_skill_library_id, p_target_level,
    p_target_date, nullif(trim(p_notes), ''), v_previous_id, auth.uid()
  )
  returning id into v_target_id;

  return v_target_id;
end
$$;

create or replace function public.close_managed_employer_skill_development_target(
  p_target_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.employer_skill_development_targets%rowtype;
begin
  if p_status not in ('completed', 'cancelled') then
    raise exception 'Target status must be completed or cancelled';
  end if;

  select target.* into v_target
  from public.employer_skill_development_targets target
  where target.id = p_target_id
  for update;

  if v_target.id is null
     or v_target.status <> 'active'
     or not private.can_manage_employer_member(
       auth.uid(), v_target.employer_member_id, 'skill_management', true
     ) then
    raise exception 'Not authorised';
  end if;

  update public.employer_skill_development_targets
  set status = p_status, closed_by = auth.uid(), closed_at = now()
  where id = p_target_id;
end
$$;

revoke all on function public.list_managed_employer_skill_development_targets(uuid, uuid) from public, anon, authenticated;
revoke all on function public.list_my_employer_skill_development_targets() from public, anon, authenticated;
revoke all on function public.set_managed_employer_skill_development_target(uuid, uuid, uuid, integer, date, text) from public, anon, authenticated;
revoke all on function public.close_managed_employer_skill_development_target(uuid, text) from public, anon, authenticated;

grant execute on function public.list_managed_employer_skill_development_targets(uuid, uuid) to authenticated;
grant execute on function public.list_my_employer_skill_development_targets() to authenticated;
grant execute on function public.set_managed_employer_skill_development_target(uuid, uuid, uuid, integer, date, text) to authenticated;
grant execute on function public.close_managed_employer_skill_development_target(uuid, text) to authenticated;
