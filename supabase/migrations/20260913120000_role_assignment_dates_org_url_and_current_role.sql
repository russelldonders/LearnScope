-- Three fixes to accepting a role profile / assigning one:
--
-- 1. A skill created (or reused) for a required/component skill now gets
--    skills.is_current_role set whenever the experience it's linked to is
--    an ongoing employment entry (end_date is null) -- previously this
--    never happened, so a skill added by accepting a role profile silently
--    never showed up under the Skills tab's "Current role" filter even
--    when linked to the learner's own open-ended job. Mirrors
--    syncSkillIsCurrentRole's own semantics (src/lib/currentRole.js) --
--    only ever turned on here, never off, since this function only ever
--    adds one link and has no visibility into the skill's other links.
--
-- 2/3. When accepting creates a brand-new experience, its start_date/
--    end_date now come from the role assignment's own dates (set by the
--    employer admin -- employer_role_assignments.start_date/end_date,
--    20260912160000) instead of always defaulting to today with no end
--    date, and its organization_url is seeded from the employer's own
--    organisations.url. When accepting links to an EXISTING experience
--    instead, its dates are never touched (the learner's own timeline
--    stays under their own control, see 20260912160000's own comment) --
--    but its organization_url is filled in too, and only when the employer
--    set no dates at all for this assignment: a dated assignment reads as
--    a specific, separate stint that shouldn't relabel an experience the
--    learner is choosing to align it with, but an undated one is closer to
--    "this basically is that role" and can safely fill in a blank-looking
--    detail like the org's official url.
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
  v_assignment_start_date date;
  v_assignment_end_date date;
  v_role_name text;
  v_employer_name text;
  v_employer_url text;
  v_experience_id uuid;
  v_experience_end_date date;
  v_is_current_role boolean;
  v_req record;
  v_component record;
  v_skill_id uuid;
begin
  select em.user_id, a.role_profile_id, a.start_date, a.end_date
  into v_user_id, v_role_profile_id, v_assignment_start_date, v_assignment_end_date
  from public.employer_role_assignments a
  join public.employer_members em on em.id = a.employer_member_id
  where a.id = p_assignment_id and a.status = 'proposed';

  if v_user_id is distinct from auth.uid() then
    raise exception 'Pending role assignment not found';
  end if;

  if p_accept then
    if p_learner_experience_id is not null then
      select id, end_date into v_experience_id, v_experience_end_date
      from public.experience
      where id = p_learner_experience_id and user_id = auth.uid() and type = 'employment';
      if v_experience_id is null then
        raise exception 'Choose one of your own employment experiences';
      end if;

      if v_assignment_start_date is null and v_assignment_end_date is null then
        select e.name, o.url into v_employer_name, v_employer_url
        from public.employer_role_profiles rp
        join public.employers e on e.id = rp.employer_id
        left join public.organisations o on o.id = e.provider_organisation_id
        where rp.id = v_role_profile_id;

        if v_employer_url is not null then
          update public.experience set organization_url = v_employer_url where id = v_experience_id;
        end if;
      end if;
    else
      select rp.name, e.name, o.url
      into v_role_name, v_employer_name, v_employer_url
      from public.employer_role_profiles rp
      join public.employers e on e.id = rp.employer_id
      left join public.organisations o on o.id = e.provider_organisation_id
      where rp.id = v_role_profile_id;

      insert into public.experience (user_id, type, title, organization, organization_url, start_date, end_date)
      values (
        auth.uid(), 'employment', v_role_name, v_employer_name, v_employer_url,
        coalesce(v_assignment_start_date, current_date), v_assignment_end_date
      )
      returning id, end_date into v_experience_id, v_experience_end_date;
    end if;

    v_is_current_role := v_experience_end_date is null;

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
        insert into public.skills (user_id, name, category, level, library_skill_id, source, is_current_role)
        values (auth.uid(), v_req.skill_name, v_req.skill_category, 1, v_req.library_skill_id, 'role_profile', v_is_current_role)
        returning id into v_skill_id;
      elsif v_is_current_role then
        update public.skills set is_current_role = true where id = v_skill_id and is_current_role is distinct from true;
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
          insert into public.skills (user_id, name, category, level, library_skill_id, source, is_current_role)
          values (auth.uid(), v_component.component_name, v_component.component_category, 1, v_component.component_skill_id, 'role_profile', v_is_current_role)
          returning id into v_skill_id;
        elsif v_is_current_role then
          update public.skills set is_current_role = true where id = v_skill_id and is_current_role is distinct from true;
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

-- 4. Lets an employer admin set the assignment's own (optional) start/end
-- date in the same action that proposes the role, instead of always having
-- to come back afterward via set_employer_role_assignment_dates
-- (20260912160000). Adding parameters changes the function's identity even
-- with defaults, so the old two-arg overload is dropped explicitly rather
-- than left behind alongside this one.
drop function if exists public.assign_employer_role_profile(uuid, uuid);

create or replace function public.assign_employer_role_profile(
  p_role_profile_id uuid,
  p_employer_member_id uuid,
  p_start_date date default null,
  p_end_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employer_id uuid;
  v_assignment_id uuid;
begin
  select rp.employer_id into v_employer_id
  from public.employer_role_profiles rp
  where rp.id = p_role_profile_id and rp.status = 'active';

  if v_employer_id is null
     or not public.is_employer_admin(v_employer_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;
  if not exists (
    select 1 from public.employer_members em
    where em.id = p_employer_member_id
      and em.employer_id = v_employer_id
      and em.role = 'member'
      and em.status = 'active'
  ) then
    raise exception 'Choose an active learner from this employer';
  end if;

  insert into public.employer_role_assignments
    (role_profile_id, employer_member_id, proposed_by, start_date, end_date)
  values (p_role_profile_id, p_employer_member_id, auth.uid(), p_start_date, p_end_date)
  on conflict (role_profile_id, employer_member_id) do update
    set status = 'proposed', learner_experience_id = null,
        proposed_by = auth.uid(), proposed_at = now(), decided_at = null,
        disconnected_at = null, start_date = p_start_date, end_date = p_end_date
    where public.employer_role_assignments.status in ('declined', 'disconnected', 'withdrawn')
  returning id into v_assignment_id;

  if v_assignment_id is null then
    raise exception 'This learner already has a live assignment for this role';
  end if;
  return v_assignment_id;
end
$$;

revoke all on function public.assign_employer_role_profile(uuid, uuid, date, date) from public, anon;
grant execute on function public.assign_employer_role_profile(uuid, uuid, date, date) to authenticated;
