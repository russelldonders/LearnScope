-- Two changes to accepting a role profile assignment, both refining
-- 20260912120000's own auto-create behaviour rather than reverting it:
--
-- 1. A required skill now actually lands on the learner's own record when
--    they accept -- reusing an already-tracked skill (matched by
--    library_skill_id, never a duplicate) or creating a new one at level 1
--    (accepting isn't evidence the target level is already met -- that's
--    still what the gap view is for), linked to the resulting experience
--    via skill_experience_links so it shows up there too. Flagged with
--    skills.source = 'role_profile' (widening the existing source concept,
--    0008/0095/20260831160500, rather than inventing a parallel one) so the
--    UI can badge it distinctly from a manually-added skill.
--
-- 2. Accepting can now target an existing employment experience instead of
--    always creating a new one -- p_learner_experience_id, optional, back
--    to being a real parameter (0903170000 had this, 20260912120000 removed
--    it entirely). Omitted/null still auto-creates, same as before; the
--    learner-facing choice ("link to an existing role, or create a new one")
--    lives entirely in the UI now instead of being a hard requirement to
--    even enable Accept.

alter table skills drop constraint skills_source_check;
alter table skills add constraint skills_source_check
  check (source in ('manual', 'cv_import', 'recommend', 'external_import', 'role_profile'));

create or replace function public.decide_employer_role_assignment(
  p_assignment_id uuid,
  p_accept boolean,
  p_learner_experience_id uuid default null
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
  v_experience_id uuid;
  v_req record;
  v_skill_id uuid;
begin
  select em.user_id, a.role_profile_id into v_user_id, v_role_profile_id
  from public.employer_role_assignments a
  join public.employer_members em on em.id = a.employer_member_id
  where a.id = p_assignment_id and a.status = 'proposed';

  if v_user_id is distinct from auth.uid() then
    raise exception 'Pending role assignment not found';
  end if;

  if p_accept then
    if p_learner_experience_id is not null then
      select id into v_experience_id
      from public.experience
      where id = p_learner_experience_id and user_id = auth.uid() and type = 'employment';
      if v_experience_id is null then
        raise exception 'Choose one of your own employment experiences';
      end if;
    else
      select rp.name, e.name into v_role_name, v_employer_name
      from public.employer_role_profiles rp
      join public.employers e on e.id = rp.employer_id
      where rp.id = v_role_profile_id;

      insert into public.experience (user_id, type, title, organization, start_date)
      values (auth.uid(), 'employment', v_role_name, v_employer_name, current_date)
      returning id into v_experience_id;
    end if;

    for v_req in
      select rps.library_skill_id, sl.name as skill_name, sl.category as skill_category
      from public.employer_role_profile_skills rps
      join public.skill_library sl on sl.id = rps.library_skill_id
      where rps.role_profile_id = v_role_profile_id
    loop
      select id into v_skill_id
      from public.skills
      where user_id = auth.uid() and library_skill_id = v_req.library_skill_id;

      if v_skill_id is null then
        insert into public.skills (user_id, name, category, level, library_skill_id, source)
        values (auth.uid(), v_req.skill_name, v_req.skill_category, 1, v_req.library_skill_id, 'role_profile')
        returning id into v_skill_id;
      end if;

      -- relationship (first_acquired/developed/applied/demonstrated) was
      -- dropped entirely in 0026 -- a skill is either linked to an
      -- experience or it isn't.
      insert into public.skill_experience_links (user_id, skill_id, experience_id)
      values (auth.uid(), v_skill_id, v_experience_id)
      on conflict (skill_id, experience_id) do nothing;
    end loop;
  end if;

  update public.employer_role_assignments
  set status = case when p_accept then 'linked' else 'declined' end,
      learner_experience_id = case when p_accept then v_experience_id else null end,
      decided_at = now(), disconnected_at = null
  where id = p_assignment_id;
end
$$;

revoke all on function public.decide_employer_role_assignment(uuid, boolean) from public, anon, authenticated;
drop function if exists public.decide_employer_role_assignment(uuid, boolean);

revoke all on function public.decide_employer_role_assignment(uuid, boolean, uuid) from public, anon;
grant execute on function public.decide_employer_role_assignment(uuid, boolean, uuid) to authenticated;
