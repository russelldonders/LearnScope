-- Run 0313. The organisation workspace's Role profiles list called
-- list_employer_role_assignments once per role profile to count each one's
-- linked employees -- an employer with 20 roles made 20 calls on every load.
-- This returns every role profile's assignments for one employer in a single
-- call, with exactly the same columns, access check and privacy narrowing as
-- list_employer_role_assignments (20260903180000), plus role_profile_id so
-- the caller can group them: only the learner-selected current role is
-- exposed, and only once linked.
--
-- New function only; no data changes. Rollback: drop it (and revert the
-- client change in the same commit).

create or replace function public.list_employer_role_assignments_for_employer(p_employer_id uuid)
returns table (
  id uuid,
  role_profile_id uuid,
  employer_member_id uuid,
  learner_user_id uuid,
  learner_name text,
  status text,
  proposed_at timestamptz,
  decided_at timestamptz,
  learner_experience_id uuid,
  current_role_title text,
  current_role_organization text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_employer_id is null
     or not public.is_employer_admin(p_employer_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;

  return query
  select
    a.id,
    a.role_profile_id,
    em.id,
    em.user_id,
    coalesce(nullif(trim(p.full_name), ''), 'Employee'),
    a.status,
    a.proposed_at,
    a.decided_at,
    case when a.status = 'linked' then e.id else null end,
    case when a.status = 'linked' then e.title else null end,
    case when a.status = 'linked' then e.organization else null end
  from public.employer_role_assignments a
  join public.employer_role_profiles rp on rp.id = a.role_profile_id
  join public.employer_members em on em.id = a.employer_member_id
  left join public.profiles p on p.id = em.user_id
  left join public.experience e on e.id = a.learner_experience_id
  where rp.employer_id = p_employer_id
  order by a.proposed_at desc;
end
$$;

revoke all on function public.list_employer_role_assignments_for_employer(uuid) from public, anon;
grant execute on function public.list_employer_role_assignments_for_employer(uuid) to authenticated;
