-- decide_employer_role_assignment (20260903170000) previously required the
-- learner to already have a current (no end_date) employment experience
-- and pick which one to link before Accept was even enabled -- a real
-- barrier for someone who hasn't logged a current role yet, and an odd
-- extra step (a learner already accepting a specific, named role profile
-- has no real reason to have to also separately pick a target). Accepting
-- now creates that experience itself: a new employment entry titled after
-- the role profile, at the employer's name, starting today -- and links to
-- that. Nothing about learner ownership changes -- it's still their own
-- experience row (RLS-owned, editable/deletable by them like any other),
-- just seeded instead of demanded up front.
create or replace function public.decide_employer_role_assignment(
  p_assignment_id uuid,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_role_profile_id uuid;
  v_role_name text;
  v_employer_name text;
  v_new_experience_id uuid;
begin
  select em.user_id, a.role_profile_id into v_user_id, v_role_profile_id
  from public.employer_role_assignments a
  join public.employer_members em on em.id = a.employer_member_id
  where a.id = p_assignment_id and a.status = 'proposed';

  if v_user_id is distinct from auth.uid() then
    raise exception 'Pending role assignment not found';
  end if;

  if p_accept then
    select rp.name, e.name into v_role_name, v_employer_name
    from public.employer_role_profiles rp
    join public.employers e on e.id = rp.employer_id
    where rp.id = v_role_profile_id;

    insert into public.experience (user_id, type, title, organization, start_date)
    values (auth.uid(), 'employment', v_role_name, v_employer_name, current_date)
    returning id into v_new_experience_id;
  end if;

  update public.employer_role_assignments
  set status = case when p_accept then 'linked' else 'declined' end,
      learner_experience_id = v_new_experience_id,
      decided_at = now(), disconnected_at = null
  where id = p_assignment_id;
end
$$;

revoke all on function public.decide_employer_role_assignment(uuid, boolean, uuid) from public, anon, authenticated;
drop function if exists public.decide_employer_role_assignment(uuid, boolean, uuid);

revoke all on function public.decide_employer_role_assignment(uuid, boolean) from public, anon;
grant execute on function public.decide_employer_role_assignment(uuid, boolean) to authenticated;
