-- Two additions for managing an employee's role profiles from their own
-- roster row (EmployerConsole.jsx's Users tab), rather than only from each
-- role profile's own "Users" tab (RoleProfileLinkedEmployeesPanel) --
-- that's still where a profile gets assigned to many people at once, this
-- is the inverse: one person's own role profiles, in one place.

-- The employer's own record of when an assignment is meant to apply --
-- separate from the learner's own linked experience's start_date/end_date
-- (which the learner controls, same as every other roster-vs-profile split
-- in this domain: employer_member_field_values, 20260911150000). An admin
-- can plan/adjust these regardless of the assignment's own accept status.
alter table public.employer_role_assignments add column start_date date;
alter table public.employer_role_assignments add column end_date date;

create or replace function public.set_employer_role_assignment_dates(
  p_assignment_id uuid,
  p_start_date date,
  p_end_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_employer_id uuid;
begin
  select rp.employer_id into v_employer_id
  from public.employer_role_assignments a
  join public.employer_role_profiles rp on rp.id = a.role_profile_id
  where a.id = p_assignment_id;

  if v_employer_id is null or not public.is_employer_admin(v_employer_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;

  update public.employer_role_assignments
  set start_date = p_start_date, end_date = p_end_date
  where id = p_assignment_id;
end
$$;

revoke all on function public.set_employer_role_assignment_dates(uuid, date, date) from public, anon;
grant execute on function public.set_employer_role_assignment_dates(uuid, date, date) to authenticated;

-- Mirrors list_employer_role_assignments (20260903180000) exactly, just
-- keyed by employer_member_id instead of role_profile_id -- one person's
-- own role profiles (whatever their status) instead of one role profile's
-- own roster of people.
create or replace function public.list_employer_role_assignments_for_member(p_employer_member_id uuid)
returns table (
  id uuid,
  role_profile_id uuid,
  role_profile_name text,
  status text,
  proposed_at timestamptz,
  decided_at timestamptz,
  start_date date,
  end_date date,
  learner_experience_id uuid,
  current_role_title text,
  current_role_organization text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_employer_id uuid;
begin
  select em.employer_id into v_employer_id
  from public.employer_members em
  where em.id = p_employer_member_id;

  if v_employer_id is null or not public.is_employer_admin(v_employer_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;

  return query
  select
    a.id,
    rp.id,
    rp.name,
    a.status,
    a.proposed_at,
    a.decided_at,
    a.start_date,
    a.end_date,
    a.learner_experience_id,
    e.title,
    e.organization
  from public.employer_role_assignments a
  join public.employer_role_profiles rp on rp.id = a.role_profile_id
  left join public.experience e on e.id = a.learner_experience_id
  where a.employer_member_id = p_employer_member_id
  order by a.proposed_at desc;
end
$$;

revoke all on function public.list_employer_role_assignments_for_member(uuid) from public, anon;
grant execute on function public.list_employer_role_assignments_for_member(uuid) to authenticated;
