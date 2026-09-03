-- Replace a role profile's requirement sets atomically. Keeping delete and
-- insert in one transaction prevents a transient API failure from leaving a
-- valid role profile with its requirements unintentionally erased.

create or replace function public.replace_employer_role_profile_skills(
  p_role_profile_id uuid,
  p_requirements jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_employer_id uuid;
begin
  if jsonb_typeof(p_requirements) <> 'array' then
    raise exception 'Skill requirements must be an array';
  end if;
  select rp.employer_id into v_employer_id
  from public.employer_role_profiles rp
  where rp.id = p_role_profile_id;
  if v_employer_id is null
     or not public.is_employer_admin(v_employer_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;

  delete from public.employer_role_profile_skills
  where role_profile_id = p_role_profile_id;

  insert into public.employer_role_profile_skills
    (role_profile_id, library_skill_id, target_level, requirement)
  select
    p_role_profile_id,
    (item->>'skillId')::uuid,
    (item->>'targetLevel')::integer,
    coalesce(nullif(item->>'requirement', ''), 'required')
  from jsonb_array_elements(p_requirements) item;
end
$$;

create or replace function public.replace_employer_role_profile_training(
  p_role_profile_id uuid,
  p_requirements jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_employer_id uuid;
begin
  if jsonb_typeof(p_requirements) <> 'array' then
    raise exception 'Training requirements must be an array';
  end if;
  select rp.employer_id into v_employer_id
  from public.employer_role_profiles rp
  where rp.id = p_role_profile_id;
  if v_employer_id is null
     or not public.is_employer_admin(v_employer_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;

  delete from public.employer_role_profile_training
  where role_profile_id = p_role_profile_id;

  insert into public.employer_role_profile_training
    (role_profile_id, catalogue_course_id, requirement)
  select
    p_role_profile_id,
    (item->>'courseId')::uuid,
    coalesce(nullif(item->>'requirement', ''), 'required')
  from jsonb_array_elements(p_requirements) item;
end
$$;

revoke all on function public.replace_employer_role_profile_skills(uuid, jsonb),
  public.replace_employer_role_profile_training(uuid, jsonb)
from public, anon;
grant execute on function public.replace_employer_role_profile_skills(uuid, jsonb),
  public.replace_employer_role_profile_training(uuid, jsonb)
to authenticated;

-- Narrow employer projection: only the learner-selected current role is
-- exposed. No other experience, skills, or personal learning are returned.
create or replace function public.list_employer_role_assignments(p_role_profile_id uuid)
returns table (
  id uuid,
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
declare v_employer_id uuid;
begin
  select rp.employer_id into v_employer_id
  from public.employer_role_profiles rp
  where rp.id = p_role_profile_id;
  if v_employer_id is null
     or not public.is_employer_admin(v_employer_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;

  return query
  select
    a.id,
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
  join public.employer_members em on em.id = a.employer_member_id
  left join public.profiles p on p.id = em.user_id
  left join public.experience e on e.id = a.learner_experience_id
  where a.role_profile_id = p_role_profile_id
  order by a.proposed_at desc;
end
$$;

revoke all on function public.list_employer_role_assignments(uuid) from public, anon;
grant execute on function public.list_employer_role_assignments(uuid) to authenticated;
