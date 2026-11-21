-- An organisation plan's admins can read its prerequisites, to set them up
-- in the organisation console (they own the plan but aren't on it, 0328).
-- As 0308 otherwise; "met" is worked out from the caller's own records, so
-- for an admin it says nothing about any member.
--
-- No data changes.

create or replace function public.get_learner_plan_prerequisites(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null or (
    private.learner_plan_role(p_plan_id) is null
    and not exists (
      select 1 from public.learner_plans
      where id = p_plan_id and private.is_learner_plan_org_admin(organisation_id)
    )
  ) then
    raise exception 'Plan not found' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', g.id,
        'position', g.position,
        'enforcement', g.enforcement,
        'options', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', p.id,
              'kind', p.kind,
              'library_skill_id', p.library_skill_id,
              'catalogue_course_id', p.catalogue_course_id,
              'min_practical_level', p.min_practical_level,
              'min_knowledge_level', p.min_knowledge_level,
              'name', case p.kind
                when 'skill' then (select l.name from public.skill_library l where l.id = p.library_skill_id)
                else (select c.name from public.course_catalogue c where c.id = p.catalogue_course_id)
              end,
              'met', private.learner_plan_prerequisite_met(p, v_user)
            )
            order by p.created_at
          )
          from public.learner_plan_prerequisites p
          where p.group_id = g.id
        ), '[]'::jsonb)
      )
      order by g.position, g.created_at
    )
    from public.learner_plan_prerequisite_groups g
    where g.plan_id = p_plan_id
  ), '[]'::jsonb);
end;
$$;

