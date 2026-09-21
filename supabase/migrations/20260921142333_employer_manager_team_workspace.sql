-- Employer-context manager workspace. These APIs intentionally project only
-- employer-owned records plus learner skills explicitly shared with this
-- employer. They never expose a general learner profile or rely on a global
-- manager flag.

create or replace function public.list_my_employer_management_contexts()
returns table (
  employer_id uuid,
  employer_name text,
  employer_slug text,
  manager_member_id uuid,
  direct_report_count bigint,
  indirect_report_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    employer.id,
    employer.name,
    organisation.slug,
    manager_member.id,
    count(*) filter (where report.report_depth = 1),
    count(*) filter (where report.report_depth > 1)
  from public.employer_members manager_member
  join public.employers employer
    on employer.id = manager_member.employer_id
  join public.organisations organisation
    on organisation.id = employer.provider_organisation_id
  cross join lateral public.list_manageable_employer_members(employer.id) report
  where manager_member.user_id = auth.uid()
    and manager_member.status = 'active'
  group by employer.id, employer.name, organisation.slug, manager_member.id
  order by employer.name, employer.id
$$;

create or replace function public.list_my_employer_team(p_employer_id uuid)
returns table (
  employee_member_id uuid,
  employee_user_id uuid,
  full_name text,
  avatar_url text,
  report_depth integer,
  access_scope text[],
  relationship_types text[],
  is_primary boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    report.employee_member_id,
    report.employee_user_id,
    coalesce(nullif(trim(profile.full_name), ''), 'Team member'),
    profile.avatar_url,
    report.report_depth,
    report.access_scope,
    case
      when report.report_depth = 1 then coalesce((
        select array_agg(distinct relationship.relationship_type order by relationship.relationship_type)
        from public.employer_management_relationships relationship
        join public.employer_members manager_member
          on manager_member.id = relationship.manager_member_id
        where manager_member.user_id = auth.uid()
          and manager_member.status = 'active'
          and relationship.employer_id = p_employer_id
          and relationship.employee_member_id = report.employee_member_id
          and relationship.valid_from <= current_date
          and (relationship.valid_until is null or relationship.valid_until > current_date)
      ), array[]::text[])
      else array['indirect']::text[]
    end,
    case
      when report.report_depth = 1 then coalesce((
        select bool_or(relationship.is_primary)
        from public.employer_management_relationships relationship
        join public.employer_members manager_member
          on manager_member.id = relationship.manager_member_id
        where manager_member.user_id = auth.uid()
          and manager_member.status = 'active'
          and relationship.employer_id = p_employer_id
          and relationship.employee_member_id = report.employee_member_id
          and relationship.valid_from <= current_date
          and (relationship.valid_until is null or relationship.valid_until > current_date)
      ), false)
      else false
    end
  from public.list_manageable_employer_members(p_employer_id) report
  join public.employer_members employee_member
    on employee_member.id = report.employee_member_id
   and employee_member.employer_id = p_employer_id
   and employee_member.status = 'active'
  left join public.profiles profile
    on profile.id = report.employee_user_id
  order by report.report_depth, full_name, report.employee_member_id
$$;

create or replace function public.get_my_employer_team_member_snapshot(
  p_employer_id uuid,
  p_employee_member_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_report record;
  v_employee_user_id uuid;
  v_scope text[];
  v_result jsonb;
begin
  select report.*
    into v_report
  from public.list_my_employer_team(p_employer_id) report
  where report.employee_member_id = p_employee_member_id;

  if not found then
    raise exception 'Team member not found';
  end if;

  v_employee_user_id := v_report.employee_user_id;
  v_scope := v_report.access_scope;

  v_result := jsonb_build_object(
    'employeeMemberId', v_report.employee_member_id,
    'employeeUserId', v_employee_user_id,
    'fullName', v_report.full_name,
    'avatarUrl', v_report.avatar_url,
    'reportDepth', v_report.report_depth,
    'accessScope', to_jsonb(v_scope),
    'relationshipTypes', to_jsonb(v_report.relationship_types),
    'isPrimary', v_report.is_primary,
    'employmentFields',
      case when 'employment' = any(v_scope) then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', definition.id,
          'key', definition.key,
          'label', definition.label,
          'fieldType', definition.field_type,
          'value', field_value.value,
          'updatedAt', field_value.updated_at
        ) order by definition.sort_order, definition.label)
        from public.employer_field_definitions definition
        left join public.employer_member_field_values field_value
          on field_value.field_definition_id = definition.id
         and field_value.employer_member_id = p_employee_member_id
        where definition.employer_id is null
           or definition.employer_id = p_employer_id
      ), '[]'::jsonb) else '[]'::jsonb end,
    'roleAssignments',
      case when 'role_assignments' = any(v_scope) then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', assignment.id,
          'status', assignment.status,
          'proposedAt', assignment.proposed_at,
          'decidedAt', assignment.decided_at,
          'roleProfileId', role_profile.id,
          'roleName', role_profile.name,
          'roleDescription', role_profile.description
        ) order by assignment.proposed_at desc)
        from public.employer_role_assignments assignment
        join public.employer_role_profiles role_profile
          on role_profile.id = assignment.role_profile_id
         and role_profile.employer_id = p_employer_id
        where assignment.employer_member_id = p_employee_member_id
      ), '[]'::jsonb) else '[]'::jsonb end,
    'trainingAssignments',
      case when 'training_assignments' = any(v_scope) then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', assignment.id,
          'catalogueCourseId', course.id,
          'name', course.name,
          'provider', course.provider,
          'courseType', course.course_type,
          'duration', course.duration,
          'status', assignment.status,
          'assignedAt', assignment.created_at
        ) order by assignment.created_at desc)
        from public.course_assignments assignment
        join public.course_catalogue course
          on course.id = assignment.catalogue_course_id
        where assignment.employer_id = p_employer_id
          and assignment.assigned_to = v_employee_user_id
      ), '[]'::jsonb) else '[]'::jsonb end,
    'skillSuggestions',
      case when 'skill_management' = any(v_scope) then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', suggestion.id,
          'skillLibraryId', suggestion.skill_library_id,
          'skillName', suggestion.skill_name,
          'suggestedTargetLevel', suggestion.suggested_target_level,
          'targetDate', suggestion.target_date,
          'comments', suggestion.comments,
          'status', suggestion.status,
          'createdAt', suggestion.created_at
        ) order by suggestion.created_at desc)
        from public.employer_skill_suggestions suggestion
        where suggestion.employer_id = p_employer_id
          and suggestion.learner_id = v_employee_user_id
      ), '[]'::jsonb) else '[]'::jsonb end,
    'skillConfirmations',
      case when 'skill_management' = any(v_scope) then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', confirmation.id,
          'skillLibraryId', confirmation.library_skill_id,
          'skillName', confirmation.skill_name,
          'confirmedLevel', confirmation.confirmed_level,
          'confirmedAt', confirmation.created_at
        ) order by confirmation.created_at desc)
        from (
          select distinct on (record.library_skill_id)
            record.id,
            record.library_skill_id,
            library_skill.name as skill_name,
            record.confirmed_level,
            record.created_at
          from public.employer_skill_confirmations record
          join public.skill_library library_skill
            on library_skill.id = record.library_skill_id
          where record.employer_id = p_employer_id
            and record.user_id = v_employee_user_id
          order by record.library_skill_id, record.created_at desc, record.id desc
        ) confirmation
      ), '[]'::jsonb) else '[]'::jsonb end,
    'sharedSkills',
      case when 'shared_skills' = any(v_scope) then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', skill.id,
          'librarySkillId', skill.library_skill_id,
          'name', skill.name,
          'category', skill.category,
          'level', skill.level,
          'evidenceVisible', 'shared_skill_evidence' = any(v_scope),
          'evidenceCount', case
            when 'shared_skill_evidence' = any(v_scope) then (
              select coalesce(sum(coalesce(cardinality(assessment.evidence_paths), 0)), 0)
              from public.skill_assessments assessment
              where assessment.skill_id = skill.id
                and assessment.user_id = v_employee_user_id
            )
            else null
          end
        ) order by skill.name, skill.id)
        from public.employer_data_access_requests access_request
        join public.employer_data_access_shared_skills shared_skill
          on shared_skill.request_id = access_request.id
        join public.skills skill
          on skill.id = shared_skill.skill_id
         and skill.user_id = v_employee_user_id
        where access_request.employer_id = p_employer_id
          and access_request.learner_id = v_employee_user_id
          and access_request.status = 'approved'
          and 'skills' = any(access_request.approved_data)
      ), '[]'::jsonb) else '[]'::jsonb end
  );

  return v_result;
end
$$;

create or replace function public.list_manager_assignable_courses(
  p_employer_id uuid,
  p_employee_member_id uuid
)
returns table (
  id uuid,
  name text,
  provider text,
  course_type text,
  duration text,
  synopsis text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_employer_member(
    auth.uid(), p_employee_member_id, 'training_assignments', true
  ) or not exists (
    select 1 from public.employer_members member
    where member.id = p_employee_member_id
      and member.employer_id = p_employer_id
      and member.status = 'active'
  ) then
    raise exception 'Not authorised';
  end if;

  return query
  select course.id, course.name, course.provider, course.course_type,
    course.duration, course.synopsis
  from public.course_catalogue course
  where public.employer_course_is_enabled(p_employer_id, course.id)
  order by course.name, course.id;
end
$$;

create or replace function public.assign_course_to_managed_employer_member(
  p_employer_id uuid,
  p_employee_member_id uuid,
  p_catalogue_course_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_user_id uuid;
  v_assignment_id uuid;
begin
  select member.user_id into v_employee_user_id
  from public.employer_members member
  where member.id = p_employee_member_id
    and member.employer_id = p_employer_id
    and member.status = 'active';

  if v_employee_user_id is null or not private.can_manage_employer_member(
    auth.uid(), p_employee_member_id, 'training_assignments', true
  ) then
    raise exception 'Not authorised';
  end if;

  if not public.employer_course_is_enabled(p_employer_id, p_catalogue_course_id) then
    raise exception 'This course is not available to this employer';
  end if;

  insert into public.course_assignments
    (employer_id, catalogue_course_id, assigned_to, assigned_by)
  values (p_employer_id, p_catalogue_course_id, v_employee_user_id, auth.uid())
  on conflict (employer_id, catalogue_course_id, assigned_to) do nothing
  returning id into v_assignment_id;

  if v_assignment_id is null then
    raise exception 'This training is already assigned';
  end if;

  return v_assignment_id;
end
$$;

create or replace function public.list_manager_suggestible_skills(
  p_employer_id uuid,
  p_employee_member_id uuid
)
returns table (
  id uuid,
  name text,
  category text,
  description text
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
    select 1 from public.employer_members member
    where member.id = p_employee_member_id
      and member.employer_id = p_employer_id
      and member.status = 'active'
  ) then
    raise exception 'Not authorised';
  end if;

  return query
  select library_skill.id, library_skill.name, library_skill.category,
    library_skill.description
  from public.employers employer
  join public.organisation_offered_skills offered_skill
    on offered_skill.organisation_id = employer.provider_organisation_id
  join public.skill_library library_skill
    on library_skill.id = offered_skill.skill_library_id
  where employer.id = p_employer_id
  order by library_skill.name, library_skill.id;
end
$$;

create or replace function public.suggest_skill_to_managed_employer_member(
  p_employer_id uuid,
  p_employee_member_id uuid,
  p_skill_library_id uuid,
  p_target_level integer default null,
  p_target_date date default null,
  p_comments text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_user_id uuid;
  v_skill_name text;
  v_suggestion_id uuid;
begin
  select member.user_id into v_employee_user_id
  from public.employer_members member
  where member.id = p_employee_member_id
    and member.employer_id = p_employer_id
    and member.status = 'active';

  if v_employee_user_id is null or not private.can_manage_employer_member(
    auth.uid(), p_employee_member_id, 'skill_management', true
  ) then
    raise exception 'Not authorised';
  end if;

  if p_target_level is not null and (p_target_level < 1 or p_target_level > 5) then
    raise exception 'Target level must be between 1 and 5';
  end if;

  select library_skill.name into v_skill_name
  from public.employers employer
  join public.organisation_offered_skills offered_skill
    on offered_skill.organisation_id = employer.provider_organisation_id
  join public.skill_library library_skill
    on library_skill.id = offered_skill.skill_library_id
  where employer.id = p_employer_id
    and library_skill.id = p_skill_library_id;

  if v_skill_name is null then
    raise exception 'This skill is not offered by this employer';
  end if;

  insert into public.employer_skill_suggestions
    (employer_id, learner_id, skill_library_id, skill_name,
     suggested_target_level, target_date, comments, assigned_by)
  values
    (p_employer_id, v_employee_user_id, p_skill_library_id, v_skill_name,
     p_target_level, p_target_date, nullif(trim(p_comments), ''), auth.uid())
  on conflict (employer_id, learner_id, skill_library_id) do update
    set status = 'suggested',
        suggested_target_level = excluded.suggested_target_level,
        target_date = excluded.target_date,
        comments = excluded.comments,
        assigned_by = excluded.assigned_by,
        created_at = now()
    where public.employer_skill_suggestions.status = 'dismissed'
  returning id into v_suggestion_id;

  if v_suggestion_id is null then
    raise exception 'This skill is already suggested or adopted';
  end if;

  return v_suggestion_id;
end
$$;

create or replace function public.confirm_managed_employer_skill_level(
  p_employer_id uuid,
  p_employee_member_id uuid,
  p_skill_library_id uuid,
  p_level smallint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_user_id uuid;
  v_confirmation_id uuid;
begin
  select member.user_id into v_employee_user_id
  from public.employer_members member
  where member.id = p_employee_member_id
    and member.employer_id = p_employer_id
    and member.status = 'active';

  if v_employee_user_id is null or not private.can_manage_employer_member(
    auth.uid(), p_employee_member_id, 'skill_management', true
  ) then
    raise exception 'Not authorised';
  end if;

  if p_level < 1 or p_level > 5 then
    raise exception 'Confirmed level must be between 1 and 5';
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

  insert into public.employer_skill_confirmations
    (employer_id, user_id, library_skill_id, confirmed_level, confirmed_by)
  values
    (p_employer_id, v_employee_user_id, p_skill_library_id, p_level, auth.uid())
  returning id into v_confirmation_id;

  return v_confirmation_id;
end
$$;

revoke all on function public.list_my_employer_management_contexts() from public, anon;
revoke all on function public.list_my_employer_team(uuid) from public, anon;
revoke all on function public.get_my_employer_team_member_snapshot(uuid, uuid) from public, anon;
revoke all on function public.list_manager_assignable_courses(uuid, uuid) from public, anon;
revoke all on function public.assign_course_to_managed_employer_member(uuid, uuid, uuid) from public, anon;
revoke all on function public.list_manager_suggestible_skills(uuid, uuid) from public, anon;
revoke all on function public.suggest_skill_to_managed_employer_member(uuid, uuid, uuid, integer, date, text) from public, anon;
revoke all on function public.confirm_managed_employer_skill_level(uuid, uuid, uuid, smallint) from public, anon;

grant execute on function public.list_my_employer_management_contexts() to authenticated;
grant execute on function public.list_my_employer_team(uuid) to authenticated;
grant execute on function public.get_my_employer_team_member_snapshot(uuid, uuid) to authenticated;
grant execute on function public.list_manager_assignable_courses(uuid, uuid) to authenticated;
grant execute on function public.assign_course_to_managed_employer_member(uuid, uuid, uuid) to authenticated;
grant execute on function public.list_manager_suggestible_skills(uuid, uuid) to authenticated;
grant execute on function public.suggest_skill_to_managed_employer_member(uuid, uuid, uuid, integer, date, text) to authenticated;
grant execute on function public.confirm_managed_employer_skill_level(uuid, uuid, uuid, smallint) to authenticated;
