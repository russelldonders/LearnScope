-- Drops skill_targets.set_by_manager, the last trace of team-set targets
-- living in the learner's own targets table. Since 20261002110000 deleted
-- those rows, every value is null, and nothing writes the column: a target
-- someone else sets lives in manager_skill_targets (with set_by). Released
-- app code reads it only as an optional property of selected rows, so the
-- drop is safe while an older frontend is still deployed.
--
-- Safety: aborts, changing nothing, if any row still has a value.
-- Rollback: re-add the column (uuid references auth.users on delete set
-- null); no data is lost, since it is empty.

do $$
begin
  if exists (select 1 from public.skill_targets where set_by_manager is not null) then
    raise exception 'Not dropping skill_targets.set_by_manager: some rows still have a value';
  end if;
end
$$;

-- Same as 20261002100000, without the now-redundant set_by_manager filter
-- on the learner's own targets.
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
      where own.skill_id = s.id
      union all
      select jsonb_build_object(
        'id', team_target.id, 'skill_id', team_target.skill_id,
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

alter table public.skill_targets drop column set_by_manager;
