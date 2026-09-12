-- Accepting a role profile that requires a composite skill (one with a
-- published skill_composite_definitions/skill_composite_components set)
-- now also creates/links each of that composite's own published component
-- skills -- previously only the composite parent itself landed on the
-- learner's record, leaving "0 of N required targets met" with nothing the
-- learner could act on without separately finding and adding each
-- component themselves. Same reuse-if-already-tracked, level-1-if-new,
-- source:'role_profile' rules as the parent skill gets (20260912170000's
-- own comment). One level deep only (a component that's itself a composite
-- parent isn't cascaded further) -- matches the common case without an
-- unbounded recursive walk inside this function.
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
  v_component record;
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

      insert into public.skill_experience_links (user_id, skill_id, experience_id)
      values (auth.uid(), v_skill_id, v_experience_id)
      on conflict (skill_id, experience_id) do nothing;

      for v_component in
        select cc.component_skill_id, csl.name as component_name, csl.category as component_category
        from public.skill_composite_definitions scd
        join public.skill_composite_components cc on cc.definition_id = scd.id
        join public.skill_library csl on csl.id = cc.component_skill_id
        where scd.parent_skill_id = v_req.library_skill_id and scd.status = 'published'
      loop
        select id into v_skill_id
        from public.skills
        where user_id = auth.uid() and library_skill_id = v_component.component_skill_id;

        if v_skill_id is null then
          insert into public.skills (user_id, name, category, level, library_skill_id, source)
          values (auth.uid(), v_component.component_name, v_component.component_category, 1, v_component.component_skill_id, 'role_profile')
          returning id into v_skill_id;
        end if;

        insert into public.skill_experience_links (user_id, skill_id, experience_id)
        values (auth.uid(), v_skill_id, v_experience_id)
        on conflict (skill_id, experience_id) do nothing;
      end loop;
    end loop;
  end if;

  update public.employer_role_assignments
  set status = case when p_accept then 'linked' else 'declined' end,
      learner_experience_id = case when p_accept then v_experience_id else null end,
      decided_at = now(), disconnected_at = null
  where id = p_assignment_id;
end
$$;
