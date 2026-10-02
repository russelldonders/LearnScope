-- Phase 2c of merging what managers do across the two management contexts
-- (see 20261001110000 and docs/architecture/manager-teams.md): the manager
-- and organisation-admin screens now read suggestions, ratings and targets
-- from the unified manager_skill_* tables instead of the per-context ones.
--
-- Every function keeps its signature and result shape. Until phase 2d moves
-- the writers, the old tables are still what gets written (and mirrored
-- here by trigger), and callers pass ids from these results back into those
-- writers -- e.g. close_managed_employer_skill_development_target(), the
-- assessment evidence upload -- so each result still carries the original
-- row's id (legacy_id), falling back to the unified id.
--
-- Access is unchanged:
--   * a team manager sees ratings and targets for skills a member shared
--     with the team, as before;
--   * an organisation manager sees what their reporting line's
--     skill_management scope allows, as before. The unified targets table
--     keeps targets from an earlier membership of the same organisation as
--     the learner's history (the old table deleted them with the
--     membership); managers only see targets set during the current one;
--   * an organisation admin can read their organisation's suggestions and
--     ratings directly, matching the select policies on
--     employer_skill_suggestions and employer_skill_confirmations. Nothing
--     else gains access, and nothing here writes.

-- ---------------------------------------------------------------------------
-- Organisation admins read their organisation's rows (direct table reads in
-- the organisation console: the suggestions roster and role-profile
-- readiness). employer_id is null once an organisation is deleted -- those
-- rows are the learner's history only. The explicit check matters because
-- is_employer_admin() is also true for a platform admin whatever the id.
-- ---------------------------------------------------------------------------

create policy "Organisation admins read their organisation's suggestions"
  on public.manager_skill_suggestions for select to authenticated
  using (context_type = 'organisation' and employer_id is not null
    and public.is_employer_admin(employer_id, (select auth.uid())));

create policy "Organisation admins read their organisation's ratings"
  on public.manager_skill_ratings for select to authenticated
  using (context_type = 'organisation' and employer_id is not null
    and public.is_employer_admin(employer_id, (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Manager teams
-- ---------------------------------------------------------------------------

create or replace function list_manager_team_member_summaries(p_team_id uuid)
returns table (
  id uuid, name text, avatar_url text, team_since timestamptz,
  shared_skills jsonb, collaborative_learning_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    coalesce(nullif(trim(p.full_name), ''), 'Team member'),
    p.avatar_url,
    coalesce(m.decided_at, m.invited_at),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'level', s.level,
        'sharedAt', ss.shared_at,
        'evidenceCount', coalesce((
          select sum(coalesce(cardinality(sa.evidence_paths), 0))
          from public.skill_assessments sa where sa.skill_id = s.id
        ), 0),
        'managerRating', (
          select jsonb_build_object('level', r.level, 'assessedAt', r.rated_at)
          from public.manager_skill_ratings r
          where r.context_type = 'team' and r.team_id = m.team_id and r.learner_id = m.member_user_id
            and r.skill_id = s.id and r.rated_by = auth.uid()
          order by r.rated_at desc limit 1
        )
      ) order by s.name)
      from public.manager_team_shared_skills ss
      join public.skills s on s.id = ss.skill_id and s.user_id = m.member_user_id
      where ss.membership_id = m.id
    ), '[]'::jsonb),
    (select count(*) from public.manager_team_activity_participants ap where ap.membership_id = m.id)
  from public.manager_team_memberships m
  join public.profiles p on p.id = m.member_user_id
  where m.team_id = p_team_id and m.role = 'member' and m.status = 'active'
    and private.can_manage_manager_team(p_team_id, auth.uid())
  order by p.full_name nulls last, m.invited_at
$$;

create or replace function list_manager_team_skill_assessments(p_membership_id uuid)
returns table (
  id uuid, skill_id uuid, level int, comments text, evidence_url text, evidence_paths text[],
  assessed_by_name text, assessed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(r.legacy_id, r.id), r.skill_id, r.level, r.comments, r.evidence_url, r.evidence_paths,
    coalesce(nullif(trim(p.full_name), ''), 'Manager'), r.rated_at
  from public.manager_team_memberships m
  join public.manager_skill_ratings r
    on r.context_type = 'team' and r.team_id = m.team_id and r.learner_id = m.member_user_id
  left join public.profiles p on p.id = r.rated_by
  where m.id = p_membership_id and r.skill_id is not null
    and (m.member_user_id = auth.uid() or private.can_manage_manager_team(m.team_id, auth.uid()))
  order by r.rated_at desc
$$;

-- Targets on a shared skill: the learner's own (skill_targets rows nobody
-- else set) plus the ones this team set. Targets other teams set no longer
-- appear here -- they belong to those teams.
create or replace function public.get_manager_team_skill_detail(p_membership_id uuid, p_skill_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Not authorised'; end if;
  select jsonb_build_object(
    'level', s.level, 'knowledge_level', s.knowledge_level,
    'assessments', coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'level', a.level, 'comments', a.comments, 'assessed_at', a.assessed_at
    ) order by a.assessed_at desc) from public.skill_assessments a where a.skill_id = s.id), '[]'::jsonb),
    'targets', coalesce((select jsonb_agg(t.target order by t.created_at desc) from (
      select to_jsonb(own) as target, own.created_at
      from public.skill_targets own
      where own.skill_id = s.id and own.set_by_manager is null
      union all
      select jsonb_build_object(
        'id', coalesce(team_target.legacy_id, team_target.id), 'skill_id', team_target.skill_id,
        'user_id', team_target.learner_id, 'target_level', team_target.target_level,
        'target_date', team_target.target_date, 'comments', team_target.notes,
        'set_by_manager', team_target.set_by, 'status', team_target.status,
        'created_at', team_target.created_at
      ), team_target.created_at
      from public.manager_skill_targets team_target
      where team_target.context_type = 'team' and team_target.team_id = m.team_id
        and team_target.learner_id = m.member_user_id and team_target.skill_id = s.id
        and team_target.status <> 'cancelled'
    ) t), '[]'::jsonb)
  ) into v_result
  from public.manager_team_memberships m
  join public.manager_team_shared_skills ss on ss.membership_id = m.id
  join public.skills s on s.id = ss.skill_id and s.user_id = m.member_user_id
  where m.id = p_membership_id and s.id = p_skill_id and m.role = 'member' and m.status = 'active'
    and private.can_manage_manager_team(m.team_id, auth.uid());
  if v_result is null then raise exception 'This skill is no longer shared with your team'; end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organisation reporting lines
-- ---------------------------------------------------------------------------

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
declare
  v_member public.employer_members;
begin
  select member.* into v_member
  from public.employer_members member
  where member.id = p_employee_member_id
    and member.employer_id = p_employer_id
    and member.status = 'active';

  if not found or not private.can_manage_employer_member(
    auth.uid(), p_employee_member_id, 'skill_management', true
  ) then
    raise exception 'Not authorised';
  end if;

  return query
  select coalesce(target.legacy_id, target.id), target.skill_library_id, library_skill.name,
    target.target_level::smallint, target.target_date, target.notes, target.status,
    target.created_at, target.closed_at
  from public.manager_skill_targets target
  join public.skill_library library_skill on library_skill.id = target.skill_library_id
  where target.context_type = 'organisation'
    and target.employer_id = p_employer_id
    and target.learner_id = v_member.user_id
    and target.created_at >= v_member.created_at
  order by (target.status = 'active') desc, target.created_at desc, target.id;
end
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
          'id', coalesce(suggestion.legacy_id, suggestion.id),
          'skillLibraryId', suggestion.skill_library_id,
          'skillName', suggestion.skill_name,
          'suggestedTargetLevel', suggestion.suggested_target_level,
          'targetDate', suggestion.target_date,
          'comments', suggestion.comments,
          'status', suggestion.status,
          'createdAt', suggestion.created_at
        ) order by suggestion.created_at desc)
        from public.manager_skill_suggestions suggestion
        where suggestion.context_type = 'organisation'
          and suggestion.employer_id = p_employer_id
          and suggestion.learner_id = v_employee_user_id
      ), '[]'::jsonb) else '[]'::jsonb end,
    'skillConfirmations',
      case when 'skill_management' = any(v_scope) then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', confirmation.id,
          'skillLibraryId', confirmation.skill_library_id,
          'skillName', confirmation.skill_name,
          'confirmedLevel', confirmation.level,
          'confirmedAt', confirmation.rated_at
        ) order by confirmation.rated_at desc)
        from (
          select distinct on (rating.skill_library_id)
            coalesce(rating.legacy_id, rating.id) as id,
            rating.skill_library_id,
            library_skill.name as skill_name,
            rating.level,
            rating.rated_at
          from public.manager_skill_ratings rating
          join public.skill_library library_skill
            on library_skill.id = rating.skill_library_id
          where rating.context_type = 'organisation'
            and rating.employer_id = p_employer_id
            and rating.learner_id = v_employee_user_id
          order by rating.skill_library_id, rating.rated_at desc, rating.id desc
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
