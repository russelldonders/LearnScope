-- Reuses learner target history, with manager attribution.
alter table public.skill_targets add column set_by_manager uuid references auth.users(id) on delete set null;

-- Narrow cross-user APIs: active membership, managing user and shared skill.
create function public.get_manager_team_skill_detail(p_membership_id uuid, p_skill_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Not authorised'; end if;
  select jsonb_build_object(
    'level', s.level, 'knowledge_level', s.knowledge_level,
    'assessments', coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'level', a.level, 'comments', a.comments, 'assessed_at', a.assessed_at
    ) order by a.assessed_at desc) from public.skill_assessments a where a.skill_id = s.id), '[]'::jsonb),
    'targets', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc)
      from public.skill_targets t where t.skill_id = s.id), '[]'::jsonb)
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

create function public.set_manager_team_skill_target(
  p_membership_id uuid, p_skill_id uuid, p_target_level int, p_target_date date, p_comments text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_learner uuid; v_target public.skill_targets;
begin
  if auth.uid() is null then raise exception 'Not authorised'; end if;
  if p_target_level is null or p_target_level not between 1 and 5 then raise exception 'Choose a target level'; end if;
  if p_target_date is null then raise exception 'Choose a target date'; end if;
  select m.member_user_id into v_learner
  from public.manager_team_memberships m
  join public.manager_team_shared_skills ss on ss.membership_id = m.id
  join public.skills s on s.id = ss.skill_id and s.user_id = m.member_user_id
  where m.id = p_membership_id and s.id = p_skill_id and m.role = 'member' and m.status = 'active'
    and private.can_manage_manager_team(m.team_id, auth.uid())
  for share of m, ss;
  if v_learner is null then raise exception 'This skill is no longer shared with your team'; end if;
  insert into public.skill_targets (skill_id, user_id, target_level, target_date, comments, set_by_manager)
  values (p_skill_id, v_learner, p_target_level, p_target_date, nullif(trim(p_comments), ''), auth.uid()) returning * into v_target;
  update public.skills set lifecycle_stage = 'target_set' where id = p_skill_id and lifecycle_stage = 'baseline_assessed';
  return to_jsonb(v_target);
end;
$$;

revoke all on function public.get_manager_team_skill_detail(uuid, uuid),
  public.set_manager_team_skill_target(uuid, uuid, int, date, text) from public, anon;
grant execute on function public.get_manager_team_skill_detail(uuid, uuid),
  public.set_manager_team_skill_target(uuid, uuid, int, date, text) to authenticated;
